const express = require("express");
const { db } = require("../db/database");
const { runEngine } = require("../engine/ruleEngine");

const router = express.Router();

function getActiveVersionId(ruleSetId) {
  const row = db
    .prepare(
      `
    SELECT id FROM rule_set_versions
    WHERE rule_set_id = ? AND status = 'active'
    ORDER BY version_number DESC LIMIT 1
  `,
    )
    .get(ruleSetId);
  return row ? row.id : null;
}

function getNextVersionNumber(ruleSetId) {
  const row = db
    .prepare(
      `
    SELECT COALESCE(MAX(version_number), 0) + 1 as next_version
    FROM rule_set_versions WHERE rule_set_id = ?
  `,
    )
    .get(ruleSetId);
  return row ? row.next_version : 1;
}

function snapshotRulesToVersion(ruleSetId, versionId) {
  const rules = db
    .prepare("SELECT * FROM rules WHERE rule_set_id = ?")
    .all(ruleSetId);

  const insertStmt = db.prepare(`
    INSERT INTO rule_versions (
      rule_set_version_id, rule_code, name, description, dimension,
      operator, threshold, unit, weight, is_enabled, severity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const rule of rules) {
    insertStmt.run(
      versionId,
      rule.code,
      rule.name,
      rule.description || "",
      rule.dimension,
      rule.operator,
      rule.threshold,
      rule.unit || "",
      rule.weight,
      rule.is_enabled,
      rule.severity,
    );
  }

  return rules.length;
}

function applyVersionToRules(ruleSetId, versionId) {
  const ruleVersions = db
    .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ?")
    .all(versionId);

  db.prepare("DELETE FROM rules WHERE rule_set_id = ?").run(ruleSetId);

  const insertStmt = db.prepare(`
    INSERT INTO rules (
      rule_set_id, code, name, description, dimension,
      operator, threshold, unit, weight, is_enabled, severity, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
  `);

  for (const rv of ruleVersions) {
    insertStmt.run(
      ruleSetId,
      rv.rule_code,
      rv.name,
      rv.description || "",
      rv.dimension,
      rv.operator,
      rv.threshold,
      rv.unit || "",
      rv.weight,
      rv.is_enabled,
      rv.severity,
    );
  }

  return ruleVersions.length;
}

function getVersionWithRules(versionId) {
  const version = db
    .prepare("SELECT * FROM rule_set_versions WHERE id = ?")
    .get(versionId);
  if (!version) return null;

  const rules = db
    .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ? ORDER BY id")
    .all(versionId);

  return { ...version, rules };
}

router.get("/rule-sets/:ruleSetId/versions", (req, res) => {
  const { ruleSetId } = req.params;
  const { status } = req.query;

  let sql = "SELECT * FROM rule_set_versions WHERE rule_set_id = ?";
  const params = [ruleSetId];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY version_number DESC";

  const versions = db.prepare(sql).all(...params);
  res.json({ code: 0, data: versions });
});

router.get("/rule-sets/:ruleSetId/versions/active", (req, res) => {
  const { ruleSetId } = req.params;
  const activeVersionId = getActiveVersionId(ruleSetId);
  if (!activeVersionId) {
    return res.json({ code: 404, message: "没有已启用的版本" });
  }
  const version = getVersionWithRules(activeVersionId);
  res.json({ code: 0, data: version });
});

router.get("/rule-sets/:ruleSetId/versions/compare", (req, res) => {
  const { ruleSetId } = req.params;
  const { version_a, version_b } = req.query;

  if (!version_a || !version_b) {
    return res.json({ code: 400, message: "请指定两个版本号进行对比" });
  }

  const versionA = db
    .prepare(
      "SELECT * FROM rule_set_versions WHERE rule_set_id = ? AND version_number = ?",
    )
    .get(ruleSetId, version_a);
  const versionB = db
    .prepare(
      "SELECT * FROM rule_set_versions WHERE rule_set_id = ? AND version_number = ?",
    )
    .get(ruleSetId, version_b);

  if (!versionA || !versionB) {
    return res.json({ code: 404, message: "版本不存在" });
  }

  const rulesA = db
    .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ?")
    .all(versionA.id);
  const rulesB = db
    .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ?")
    .all(versionB.id);

  const rulesMapA = {};
  const rulesMapB = {};

  for (const r of rulesA) rulesMapA[r.rule_code] = r;
  for (const r of rulesB) rulesMapB[r.rule_code] = r;

  const allCodes = new Set([...Object.keys(rulesMapA), ...Object.keys(rulesMapB)]);
  const diffs = [];

  for (const code of allCodes) {
    const a = rulesMapA[code];
    const b = rulesMapB[code];

    if (!a && b) {
      diffs.push({
        rule_code: code,
        type: "added",
        rule_b: b,
      });
    } else if (a && !b) {
      diffs.push({
        rule_code: code,
        type: "removed",
        rule_a: a,
      });
    } else {
      const fields = [
        "name",
        "description",
        "dimension",
        "operator",
        "threshold",
        "unit",
        "weight",
        "is_enabled",
        "severity",
      ];
      const fieldDiffs = [];
      for (const field of fields) {
        if (a[field] !== b[field]) {
          fieldDiffs.push({
            field,
            old_value: a[field],
            new_value: b[field],
          });
        }
      }
      if (fieldDiffs.length > 0) {
        diffs.push({
          rule_code: code,
          type: "modified",
          field_diffs: fieldDiffs,
          rule_a: a,
          rule_b: b,
        });
      }
    }
  }

  res.json({
    code: 0,
    data: {
      version_a: {
        id: versionA.id,
        version_number: versionA.version_number,
        name: versionA.name,
        status: versionA.status,
        rule_count: rulesA.length,
      },
      version_b: {
        id: versionB.id,
        version_number: versionB.version_number,
        name: versionB.name,
        status: versionB.status,
        rule_count: rulesB.length,
      },
      diff_count: diffs.length,
      diffs,
    },
  });
});

router.get("/rule-sets/:ruleSetId/versions/:versionId", (req, res) => {
  const { versionId } = req.params;
  if (isNaN(parseInt(versionId))) {
    return res.json({ code: 400, message: "无效的版本ID" });
  }
  const version = getVersionWithRules(versionId);
  if (!version) {
    return res.json({ code: 404, message: "版本不存在" });
  }
  res.json({ code: 0, data: version });
});

router.post("/rule-sets/:ruleSetId/versions", (req, res) => {
  const { ruleSetId } = req.params;
  const { name, description, change_log, created_by } = req.body;

  if (!name) {
    return res.json({ code: 400, message: "版本名称不能为空" });
  }

  const ruleSet = db
    .prepare("SELECT * FROM rule_sets WHERE id = ?")
    .get(ruleSetId);
  if (!ruleSet) {
    return res.json({ code: 404, message: "规则集不存在" });
  }

  const now = Math.floor(Date.now() / 1000);
  const nextVersion = getNextVersionNumber(ruleSetId);

  const insertVersion = db.prepare(`
    INSERT INTO rule_set_versions (
      rule_set_id, version_number, name, description,
      status, created_by, change_log, created_at
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
  `);

  const result = insertVersion.run(
    ruleSetId,
    nextVersion,
    name,
    description || "",
    created_by || "",
    change_log || "",
    now,
  );

  const versionId = result.lastInsertRowid;
  const ruleCount = snapshotRulesToVersion(ruleSetId, versionId);

  const version = getVersionWithRules(versionId);
  res.json({
    code: 0,
    data: { ...version, rule_count: ruleCount },
  });
});

router.post("/rule-sets/:ruleSetId/versions/:versionId/activate", (req, res) => {
  const { ruleSetId, versionId } = req.params;

  const version = db
    .prepare("SELECT * FROM rule_set_versions WHERE id = ? AND rule_set_id = ?")
    .get(versionId, ruleSetId);
  if (!version) {
    return res.json({ code: 404, message: "版本不存在" });
  }

  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE rule_set_versions SET status = 'archived' WHERE rule_set_id = ? AND status = 'active'",
    ).run(ruleSetId);

    db.prepare(
      "UPDATE rule_set_versions SET status = 'active', activated_at = ? WHERE id = ?",
    ).run(now, versionId);

    const ruleCount = applyVersionToRules(ruleSetId, versionId);

    return ruleCount;
  });

  try {
    const ruleCount = tx();
    const updatedVersion = getVersionWithRules(versionId);
    res.json({
      code: 0,
      data: { ...updatedVersion, rule_count: ruleCount },
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post("/rule-sets/:ruleSetId/versions/:versionId/rollback", (req, res) => {
  const { ruleSetId, versionId } = req.params;

  const version = db
    .prepare("SELECT * FROM rule_set_versions WHERE id = ? AND rule_set_id = ?")
    .get(versionId, ruleSetId);
  if (!version) {
    return res.json({ code: 404, message: "版本不存在" });
  }

  const now = Math.floor(Date.now() / 1000);
  const nextVersion = getNextVersionNumber(ruleSetId);

  const tx = db.transaction(() => {
    const insertVersion = db.prepare(`
      INSERT INTO rule_set_versions (
        rule_set_id, version_number, name, description,
        status, created_by, change_log, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `);

    const newVersionName = `${version.name} (回滚)`;
    const changeLog = `回滚到版本 v${version.version_number}: ${version.name}`;

    const newVersionResult = insertVersion.run(
      ruleSetId,
      nextVersion,
      newVersionName,
      version.description || "",
      "system",
      changeLog,
      now,
    );

    const newVersionId = newVersionResult.lastInsertRowid;

    const oldRules = db
      .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ?")
      .all(versionId);

    const insertRule = db.prepare(`
      INSERT INTO rule_versions (
        rule_set_version_id, rule_code, name, description, dimension,
        operator, threshold, unit, weight, is_enabled, severity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const rule of oldRules) {
      insertRule.run(
        newVersionId,
        rule.rule_code,
        rule.name,
        rule.description || "",
        rule.dimension,
        rule.operator,
        rule.threshold,
        rule.unit || "",
        rule.weight,
        rule.is_enabled,
        rule.severity,
      );
    }

    db.prepare(
      "UPDATE rule_set_versions SET status = 'archived' WHERE rule_set_id = ? AND status = 'active' AND id != ?",
    ).run(ruleSetId, newVersionId);

    db.prepare(
      "UPDATE rule_set_versions SET activated_at = ? WHERE id = ?",
    ).run(now, newVersionId);

    applyVersionToRules(ruleSetId, newVersionId);

    return newVersionId;
  });

  try {
    const newVersionId = tx();
    const newVersion = getVersionWithRules(newVersionId);
    res.json({
      code: 0,
      data: {
        message: "回滚成功，已创建新版本",
        rolled_back_from: version.version_number,
        new_version: newVersion,
      },
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.post("/rule-sets/:ruleSetId/versions/:versionId/preview-detect", (req, res) => {
  const { versionId } = req.params;
  const { metrics } = req.body;

  if (!metrics) {
    return res.json({ code: 400, message: "缺少 metrics 参数" });
  }

  const versionRules = db
    .prepare("SELECT * FROM rule_versions WHERE rule_set_version_id = ?")
    .all(versionId);

  if (versionRules.length === 0) {
    return res.json({ code: 404, message: "版本不存在或没有规则" });
  }

  const rules = versionRules.map((rv) => ({
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

  const result = runEngine(metrics, rules);
  res.json({ code: 0, data: result });
});

module.exports = { router, getActiveVersionId };
