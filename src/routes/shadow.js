const express = require("express");
const { db } = require("../db/database");
const { runEngine } = require("../engine/ruleEngine");

const router = express.Router();

function getVersionRules(versionId) {
  const versionRules = db
    .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ?")
    .all(versionId);

  return versionRules.map((rv) => ({
    id: rv.id,
    code: rv.rule_code,
    name: rv.name,
    description: rv.description,
    dimension: rv.dimension,
    operator: rv.operator,
    threshold: rv.threshold,
    unit: rv.unit,
    weight: rv.weight,
    is_enabled: rv.is_enabled,
    severity: rv.severity,
  }));
}

function calculateDiff(baselineResult, candidateResult) {
  const hasDiff =
    baselineResult.level !== candidateResult.level ||
    baselineResult.totalScore !== candidateResult.totalScore ||
    baselineResult.hitRules.length !== candidateResult.hitRules.length;

  const diffDetails = {
    level_changed: baselineResult.level !== candidateResult.level,
    level_from: baselineResult.level,
    level_to: candidateResult.level,
    score_changed: baselineResult.totalScore !== candidateResult.totalScore,
    score_from: baselineResult.totalScore,
    score_to: candidateResult.totalScore,
    score_delta: candidateResult.totalScore - baselineResult.totalScore,
  };

  const baselineCodes = new Set(baselineResult.hitRules.map((r) => r.code));
  const candidateCodes = new Set(candidateResult.hitRules.map((r) => r.code));

  const addedRules = candidateResult.hitRules.filter(
    (r) => !baselineCodes.has(r.code),
  );
  const removedRules = baselineResult.hitRules.filter(
    (r) => !candidateCodes.has(r.code),
  );

  const commonCodes = [...baselineCodes].filter((c) => candidateCodes.has(c));
  const modifiedRules = [];

  for (const code of commonCodes) {
    const br = baselineResult.hitRules.find((r) => r.code === code);
    const cr = candidateResult.hitRules.find((r) => r.code === code);
    if (br.weight !== cr.weight || br.severity !== cr.severity) {
      modifiedRules.push({
        code,
        name: br.name,
        weight_from: br.weight,
        weight_to: cr.weight,
        severity_from: br.severity,
        severity_to: cr.severity,
      });
    }
  }

  diffDetails.rules_added = addedRules.map((r) => ({
    code: r.code,
    name: r.name,
    dimension: r.dimension,
    weight: r.weight,
    severity: r.severity,
  }));
  diffDetails.rules_removed = removedRules.map((r) => ({
    code: r.code,
    name: r.name,
    dimension: r.dimension,
    weight: r.weight,
    severity: r.severity,
  }));
  diffDetails.rules_modified = modifiedRules;
  diffDetails.hit_count_from = baselineResult.hitRules.length;
  diffDetails.hit_count_to = candidateResult.hitRules.length;

  return {
    hasDiff:
      hasDiff || addedRules.length > 0 || removedRules.length > 0 || modifiedRules.length > 0,
    details: diffDetails,
  };
}

function runShadowEvaluation(evaluationId) {
  const evaluation = db
    .prepare("SELECT * FROM shadow_evaluations WHERE id = ?")
    .get(evaluationId);
  if (!evaluation) return;

  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    "UPDATE shadow_evaluations SET status = 'running', started_at = ? WHERE id = ?",
  ).run(now, evaluationId);

  const baselineRules = getVersionRules(evaluation.baseline_version_id);
  const candidateRules = getVersionRules(evaluation.candidate_version_id);

  const sampleRecords = db
    .prepare(
      `
    SELECT dr.id, dr.metrics, dr.app_id, dr.app_name, dr.category_code
    FROM detection_records dr
    WHERE dr.category_code = (
      SELECT category_code FROM rule_sets WHERE id = ?
    )
    ORDER BY dr.created_at DESC
    LIMIT ?
  `,
    )
    .all(evaluation.rule_set_id, evaluation.sample_count || 100);

  const insertResult = db.prepare(`
    INSERT INTO shadow_evaluation_results (
      evaluation_id, detection_record_id,
      baseline_total_score, baseline_level, baseline_hit_rules,
      candidate_total_score, candidate_level, candidate_hit_rules,
      has_diff, diff_details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let diffCount = 0;
  const levelChanges = {
    compliant_to_suspicious: 0,
    compliant_to_violation: 0,
    suspicious_to_compliant: 0,
    suspicious_to_violation: 0,
    violation_to_compliant: 0,
    violation_to_suspicious: 0,
    no_change: 0,
  };

  const tx = db.transaction(() => {
    for (const record of sampleRecords) {
      const metrics = JSON.parse(record.metrics);

      const baselineResult = runEngine(metrics, baselineRules);
      const candidateResult = runEngine(metrics, candidateRules);

      const { hasDiff, details } = calculateDiff(baselineResult, candidateResult);

      if (hasDiff) diffCount++;

      const changeKey = `${baselineResult.level}_to_${candidateResult.level}`;
      if (baselineResult.level === candidateResult.level) {
        levelChanges.no_change++;
      } else if (levelChanges[changeKey] !== undefined) {
        levelChanges[changeKey]++;
      }

      insertResult.run(
        evaluationId,
        record.id,
        baselineResult.totalScore,
        baselineResult.level,
        JSON.stringify(baselineResult.hitRules),
        candidateResult.totalScore,
        candidateResult.level,
        JSON.stringify(candidateResult.hitRules),
        hasDiff ? 1 : 0,
        JSON.stringify(details),
      );
    }

    const summary = {
      total_samples: sampleRecords.length,
      diff_count: diffCount,
      diff_rate:
        sampleRecords.length > 0
          ? Number(((diffCount / sampleRecords.length) * 100).toFixed(2))
          : 0,
      level_changes: levelChanges,
    };

    db.prepare(
      `
      UPDATE shadow_evaluations
      SET status = 'completed', completed_at = ?,
          sample_count = ?, diff_count = ?, result_summary = ?
      WHERE id = ?
    `,
    ).run(
      Math.floor(Date.now() / 1000),
      sampleRecords.length,
      diffCount,
      JSON.stringify(summary),
      evaluationId,
    );

    return { diffCount, totalSamples: sampleRecords.length };
  });

  try {
    tx();
  } catch (err) {
    db.prepare(
      "UPDATE shadow_evaluations SET status = 'failed', result_summary = ? WHERE id = ?",
    ).run(JSON.stringify({ error: err.message }), evaluationId);
  }
}

router.get("/evaluations", (req, res) => {
  const { rule_set_id, status } = req.query;

  let sql = "SELECT * FROM shadow_evaluations WHERE 1=1";
  const params = [];

  if (rule_set_id) {
    sql += " AND rule_set_id = ?";
    params.push(rule_set_id);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC";

  const evaluations = db.prepare(sql).all(...params);

  const result = evaluations.map((e) => ({
    ...e,
    result_summary: e.result_summary ? JSON.parse(e.result_summary) : null,
  }));

  res.json({ code: 0, data: result });
});

router.get("/evaluations/:id", (req, res) => {
  const { id } = req.params;

  const evaluation = db
    .prepare("SELECT * FROM shadow_evaluations WHERE id = ?")
    .get(id);
  if (!evaluation) {
    return res.json({ code: 404, message: "评测任务不存在" });
  }

  const baselineVersion = db
    .prepare(
      "SELECT id, version_number, name, status FROM rule_set_versions WHERE id = ?",
    )
    .get(evaluation.baseline_version_id);
  const candidateVersion = db
    .prepare(
      "SELECT id, version_number, name, status FROM rule_set_versions WHERE id = ?",
    )
    .get(evaluation.candidate_version_id);

  res.json({
    code: 0,
    data: {
      ...evaluation,
      result_summary: evaluation.result_summary
        ? JSON.parse(evaluation.result_summary)
        : null,
      baseline_version: baselineVersion,
      candidate_version: candidateVersion,
    },
  });
});

router.get("/evaluations/:id/results", (req, res) => {
  const { id } = req.params;
  const { has_diff, limit, offset } = req.query;

  let sql = "SELECT * FROM shadow_evaluation_results WHERE evaluation_id = ?";
  const params = [id];

  if (has_diff !== undefined) {
    sql += " AND has_diff = ?";
    params.push(has_diff === "true" ? 1 : 0);
  }

  sql += " ORDER BY id";

  const lim = parseInt(limit) || 20;
  const off = parseInt(offset) || 0;
  sql += " LIMIT ? OFFSET ?";
  params.push(lim, off);

  const results = db.prepare(sql).all(...params);

  const parsed = results.map((r) => ({
    ...r,
    baseline_hit_rules: JSON.parse(r.baseline_hit_rules),
    candidate_hit_rules: JSON.parse(r.candidate_hit_rules),
    diff_details: r.diff_details ? JSON.parse(r.diff_details) : null,
  }));

  const countSql = sql
    .replace(/SELECT \* FROM/, "SELECT COUNT(*) as cnt FROM")
    .replace(/ ORDER BY.*/, "")
    .replace(/ LIMIT.*/, "");
  const countParams = params.slice(0, params.length - 2);
  const total = db.prepare(countSql).get(...countParams).cnt;

  res.json({
    code: 0,
    data: { list: parsed, total, limit: lim, offset: off },
  });
});

router.get("/evaluations/:id/diff-summary", (req, res) => {
  const { id } = req.params;

  const evaluation = db
    .prepare("SELECT * FROM shadow_evaluations WHERE id = ?")
    .get(id);
  if (!evaluation) {
    return res.json({ code: 404, message: "评测任务不存在" });
  }

  if (evaluation.status !== "completed") {
    return res.json({ code: 400, message: "评测尚未完成" });
  }

  const diffResults = db
    .prepare(
      "SELECT * FROM shadow_evaluation_results WHERE evaluation_id = ? AND has_diff = 1",
    )
    .all(id);

  const ruleImpact = {};
  const levelTransitions = {};

  for (const result of diffResults) {
    const details = JSON.parse(result.diff_details);

    for (const rule of details.rules_added || []) {
      if (!ruleImpact[rule.code]) {
        ruleImpact[rule.code] = {
          code: rule.code,
          name: rule.name,
          added_count: 0,
          removed_count: 0,
          severity: rule.severity,
          dimension: rule.dimension,
        };
      }
      ruleImpact[rule.code].added_count++;
    }

    for (const rule of details.rules_removed || []) {
      if (!ruleImpact[rule.code]) {
        ruleImpact[rule.code] = {
          code: rule.code,
          name: rule.name,
          added_count: 0,
          removed_count: 0,
          severity: rule.severity,
          dimension: rule.dimension,
        };
      }
      ruleImpact[rule.code].removed_count++;
    }

    const transition = `${details.level_from}->${details.level_to}`;
    if (!levelTransitions[transition]) {
      levelTransitions[transition] = 0;
    }
    levelTransitions[transition]++;
  }

  const ruleImpactList = Object.values(ruleImpact).sort(
    (a, b) => b.added_count + b.removed_count - (a.added_count + a.removed_count),
  );

  const totalViolationIncrease =
    (levelTransitions["compliant->violation"] || 0) +
    (levelTransitions["suspicious->violation"] || 0);
  const totalViolationDecrease =
    (levelTransitions["violation->compliant"] || 0) +
    (levelTransitions["violation->suspicious"] || 0);

  res.json({
    code: 0,
    data: {
      total_samples: evaluation.sample_count,
      total_diffs: evaluation.diff_count,
      diff_rate:
        evaluation.sample_count > 0
          ? Number(((evaluation.diff_count / evaluation.sample_count) * 100).toFixed(2))
          : 0,
      level_transitions: levelTransitions,
      violation_net_change: totalViolationIncrease - totalViolationDecrease,
      violation_increase: totalViolationIncrease,
      violation_decrease: totalViolationDecrease,
      rule_impact: ruleImpactList,
    },
  });
});

router.post("/evaluations", (req, res) => {
  const {
    rule_set_id,
    baseline_version_id,
    candidate_version_id,
    name,
    description,
    sample_count,
  } = req.body;

  if (
    !rule_set_id ||
    !baseline_version_id ||
    !candidate_version_id ||
    !name
  ) {
    return res.json({ code: 400, message: "缺少必要参数" });
  }

  const ruleSet = db
    .prepare("SELECT * FROM rule_sets WHERE id = ?")
    .get(rule_set_id);
  if (!ruleSet) {
    return res.json({ code: 404, message: "规则集不存在" });
  }

  const baselineVersion = db
    .prepare(
      "SELECT * FROM rule_set_versions WHERE id = ? AND rule_set_id = ?",
    )
    .get(baseline_version_id, rule_set_id);
  if (!baselineVersion) {
    return res.json({ code: 404, message: "基线版本不存在" });
  }

  const candidateVersion = db
    .prepare(
      "SELECT * FROM rule_set_versions WHERE id = ? AND rule_set_id = ?",
    )
    .get(candidate_version_id, rule_set_id);
  if (!candidateVersion) {
    return res.json({ code: 404, message: "候选版本不存在" });
  }

  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO shadow_evaluations (
      rule_set_id, baseline_version_id, candidate_version_id,
      name, description, sample_count, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  const result = stmt.run(
    rule_set_id,
    baseline_version_id,
    candidate_version_id,
    name,
    description || "",
    sample_count || 100,
    now,
  );

  const evaluationId = result.lastInsertRowid;

  setImmediate(() => {
    runShadowEvaluation(evaluationId);
  });

  const evaluation = db
    .prepare("SELECT * FROM shadow_evaluations WHERE id = ?")
    .get(evaluationId);

  res.json({
    code: 0,
    data: {
      ...evaluation,
      message: "评测任务已创建，正在后台执行",
    },
  });
});

router.post("/evaluations/:id/run", (req, res) => {
  const { id } = req.params;

  const evaluation = db
    .prepare("SELECT * FROM shadow_evaluations WHERE id = ?")
    .get(id);
  if (!evaluation) {
    return res.json({ code: 404, message: "评测任务不存在" });
  }

  if (evaluation.status === "running") {
    return res.json({ code: 400, message: "评测正在运行中，请稍候" });
  }

  db.prepare(
    "DELETE FROM shadow_evaluation_results WHERE evaluation_id = ?",
  ).run(id);

  setImmediate(() => {
    runShadowEvaluation(id);
  });

  res.json({
    code: 0,
    data: {
      message: "评测任务已重新启动",
      evaluation_id: id,
    },
  });
});

module.exports = router;
