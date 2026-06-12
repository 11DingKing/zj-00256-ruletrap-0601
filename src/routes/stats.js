const express = require("express");
const { db } = require("../db/database");

const router = express.Router();

router.get("/level-distribution", (req, res) => {
  const { category_code, start_time, end_time } = req.query;

  let sql = "SELECT level, COUNT(*) as count FROM detection_records WHERE 1=1";
  const params = [];

  if (category_code) {
    sql += " AND category_code = ?";
    params.push(category_code);
  }
  if (start_time) {
    sql += " AND created_at >= ?";
    params.push(start_time);
  }
  if (end_time) {
    sql += " AND created_at <= ?";
    params.push(end_time);
  }

  sql += " GROUP BY level";

  const rows = db.prepare(sql).all(...params);

  const levelMap = {
    compliant: 0,
    suspicious: 0,
    violation: 0,
  };

  let total = 0;
  for (const row of rows) {
    levelMap[row.level] = row.count;
    total += row.count;
  }

  const distribution = Object.entries(levelMap).map(([level, count]) => ({
    level,
    count,
    percentage: total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
  }));

  res.json({
    code: 0,
    data: {
      total,
      distribution,
    },
  });
});

router.get("/rule-hit-frequency", (req, res) => {
  const { category_code, rule_set_id, limit, start_time, end_time } = req.query;

  let sql =
    "SELECT id, hit_rules, category_code, rule_set_id FROM detection_records WHERE 1=1";
  const params = [];

  if (category_code) {
    sql += " AND category_code = ?";
    params.push(category_code);
  }
  if (rule_set_id) {
    sql += " AND rule_set_id = ?";
    params.push(rule_set_id);
  }
  if (start_time) {
    sql += " AND created_at >= ?";
    params.push(start_time);
  }
  if (end_time) {
    sql += " AND created_at <= ?";
    params.push(end_time);
  }

  const records = db.prepare(sql).all(...params);

  const hitCountMap = {};
  const ruleInfoMap = {};

  for (const record of records) {
    const hitRules = JSON.parse(record.hit_rules);
    for (const rule of hitRules) {
      if (!hitCountMap[rule.code]) {
        hitCountMap[rule.code] = 0;
        ruleInfoMap[rule.code] = {
          code: rule.code,
          name: rule.name,
          dimension: rule.dimension,
          severity: rule.severity,
          weight: rule.weight,
        };
      }
      hitCountMap[rule.code]++;
    }
  }

  const totalRecords = records.length;
  const frequencyList = Object.entries(hitCountMap)
    .map(([code, count]) => ({
      ...ruleInfoMap[code],
      hit_count: count,
      hit_rate:
        totalRecords > 0
          ? Number(((count / totalRecords) * 100).toFixed(2))
          : 0,
    }))
    .sort((a, b) => b.hit_count - a.hit_count);

  const lim = parseInt(limit) || 20;
  const result = frequencyList.slice(0, lim);

  res.json({
    code: 0,
    data: {
      total_records: totalRecords,
      hit_rules_count: frequencyList.length,
      top_list: result,
    },
  });
});

router.get("/category-summary", (req, res) => {
  const sql = `
    SELECT 
      c.code as category_code,
      c.name as category_name,
      COUNT(dr.id) as total_records,
      SUM(CASE WHEN dr.level = 'compliant' THEN 1 ELSE 0 END) as compliant_count,
      SUM(CASE WHEN dr.level = 'suspicious' THEN 1 ELSE 0 END) as suspicious_count,
      SUM(CASE WHEN dr.level = 'violation' THEN 1 ELSE 0 END) as violation_count,
      COALESCE(AVG(dr.total_score), 0) as avg_score
    FROM app_categories c
    LEFT JOIN detection_records dr ON c.code = dr.category_code
    GROUP BY c.code, c.name
    ORDER BY total_records DESC
  `;

  const rows = db.prepare(sql).all();

  const result = rows.map((row) => ({
    ...row,
    compliant_rate:
      row.total_records > 0
        ? Number(((row.compliant_count / row.total_records) * 100).toFixed(2))
        : 0,
    violation_rate:
      row.total_records > 0
        ? Number(((row.violation_count / row.total_records) * 100).toFixed(2))
        : 0,
    avg_score: Number(row.avg_score.toFixed(2)),
  }));

  res.json({ code: 0, data: result });
});

router.get("/overview", (req, res) => {
  const totalRecords = db
    .prepare("SELECT COUNT(*) as cnt FROM detection_records")
    .get().cnt;
  const totalRules = db.prepare("SELECT COUNT(*) as cnt FROM rules").get().cnt;
  const enabledRules = db
    .prepare("SELECT COUNT(*) as cnt FROM rules WHERE is_enabled = 1")
    .get().cnt;
  const totalRuleSets = db
    .prepare("SELECT COUNT(*) as cnt FROM rule_sets")
    .get().cnt;
  const totalCategories = db
    .prepare("SELECT COUNT(*) as cnt FROM app_categories")
    .get().cnt;
  const totalVersions = db
    .prepare("SELECT COUNT(*) as cnt FROM rule_set_versions")
    .get().cnt;
  const activeVersions = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM rule_set_versions WHERE status = 'active'",
    )
    .get().cnt;

  const levelSql =
    "SELECT level, COUNT(*) as count FROM detection_records GROUP BY level";
  const levelRows = db.prepare(levelSql).all();
  const levelMap = { compliant: 0, suspicious: 0, violation: 0 };
  for (const row of levelRows) {
    levelMap[row.level] = row.count;
  }

  const violationRate =
    totalRecords > 0
      ? Number(((levelMap.violation / totalRecords) * 100).toFixed(2))
      : 0;

  res.json({
    code: 0,
    data: {
      total_records: totalRecords,
      total_rules: totalRules,
      enabled_rules: enabledRules,
      total_rule_sets: totalRuleSets,
      total_categories: totalCategories,
      total_versions: totalVersions,
      active_versions: activeVersions,
      level_distribution: levelMap,
      violation_rate: violationRate,
    },
  });
});

router.get("/version-detection-trend", (req, res) => {
  const { version_id, days } = req.query;

  if (!version_id) {
    return res.json({ code: 400, message: "请指定版本ID" });
  }

  const version = db
    .prepare("SELECT * FROM rule_set_versions WHERE id = ?")
    .get(version_id);
  if (!version) {
    return res.json({ code: 404, message: "版本不存在" });
  }

  const daysBack = parseInt(days) || 7;
  const now = Math.floor(Date.now() / 1000);
  const startTime = version.activated_at
    ? version.activated_at - daysBack * 24 * 60 * 60
    : now - daysBack * 24 * 60 * 60;
  const endTime = now + 24 * 60 * 60;

  const sql = `
    SELECT
      date(datetime(created_at, 'unixepoch')) as date,
      COUNT(*) as total,
      SUM(CASE WHEN level = 'compliant' THEN 1 ELSE 0 END) as compliant,
      SUM(CASE WHEN level = 'suspicious' THEN 1 ELSE 0 END) as suspicious,
      SUM(CASE WHEN level = 'violation' THEN 1 ELSE 0 END) as violation,
      AVG(total_score) as avg_score
    FROM detection_records
    WHERE rule_set_id = ? AND created_at >= ? AND created_at <= ?
    GROUP BY date(datetime(created_at, 'unixepoch'))
    ORDER BY date
  `;

  const rows = db.prepare(sql).all(version.rule_set_id, startTime, endTime);

  const dailyStats = rows.map((row) => ({
    date: row.date,
    total: row.total,
    compliant: row.compliant,
    suspicious: row.suspicious,
    violation: row.violation,
    avg_score: Number(row.avg_score.toFixed(2)),
    violation_rate:
      row.total > 0
        ? Number(((row.violation / row.total) * 100).toFixed(2))
        : 0,
  }));

  res.json({
    code: 0,
    data: {
      version: {
        id: version.id,
        version_number: version.version_number,
        name: version.name,
        status: version.status,
        activated_at: version.activated_at,
      },
      activated_date: version.activated_at
        ? new Date(version.activated_at * 1000).toISOString().split("T")[0]
        : null,
      daily_stats: dailyStats,
      days_analyzed: daysBack,
    },
  });
});

router.get("/version-impact", (req, res) => {
  const { version_id } = req.query;

  if (!version_id) {
    return res.json({ code: 400, message: "请指定版本ID" });
  }

  const version = db
    .prepare("SELECT * FROM rule_set_versions WHERE id = ?")
    .get(version_id);
  if (!version) {
    return res.json({ code: 404, message: "版本不存在" });
  }

  if (!version.activated_at) {
    return res.json({ code: 400, message: "该版本尚未启用，无法统计上线影响" });
  }

  const beforeSql = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN level = 'compliant' THEN 1 ELSE 0 END) as compliant,
      SUM(CASE WHEN level = 'suspicious' THEN 1 ELSE 0 END) as suspicious,
      SUM(CASE WHEN level = 'violation' THEN 1 ELSE 0 END) as violation,
      AVG(total_score) as avg_score
    FROM detection_records
    WHERE rule_set_id = ? AND created_at < ?
  `;

  const afterSql = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN level = 'compliant' THEN 1 ELSE 0 END) as compliant,
      SUM(CASE WHEN level = 'suspicious' THEN 1 ELSE 0 END) as suspicious,
      SUM(CASE WHEN level = 'violation' THEN 1 ELSE 0 END) as violation,
      AVG(total_score) as avg_score
    FROM detection_records
    WHERE rule_set_id = ? AND created_at >= ?
  `;

  const before = db
    .prepare(beforeSql)
    .get(version.rule_set_id, version.activated_at);
  const after = db
    .prepare(afterSql)
    .get(version.rule_set_id, version.activated_at);

  const calcRate = (count, total) =>
    total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0;

  const beforeData = {
    total: before.total || 0,
    compliant: before.compliant || 0,
    suspicious: before.suspicious || 0,
    violation: before.violation || 0,
    avg_score: before.avg_score ? Number(before.avg_score.toFixed(2)) : 0,
    compliant_rate: calcRate(before.compliant || 0, before.total || 0),
    violation_rate: calcRate(before.violation || 0, before.total || 0),
  };

  const afterData = {
    total: after.total || 0,
    compliant: after.compliant || 0,
    suspicious: after.suspicious || 0,
    violation: after.violation || 0,
    avg_score: after.avg_score ? Number(after.avg_score.toFixed(2)) : 0,
    compliant_rate: calcRate(after.compliant || 0, after.total || 0),
    violation_rate: calcRate(after.violation || 0, after.total || 0),
  };

  const diff = {
    total: afterData.total - beforeData.total,
    compliant: afterData.compliant - beforeData.compliant,
    suspicious: afterData.suspicious - beforeData.suspicious,
    violation: afterData.violation - beforeData.violation,
    avg_score: Number((afterData.avg_score - beforeData.avg_score).toFixed(2)),
    compliant_rate: Number(
      (afterData.compliant_rate - beforeData.compliant_rate).toFixed(2),
    ),
    violation_rate: Number(
      (afterData.violation_rate - beforeData.violation_rate).toFixed(2),
    ),
  };

  const beforeRuleSql = `
    SELECT id, hit_rules FROM detection_records
    WHERE rule_set_id = ? AND created_at < ?
  `;
  const afterRuleSql = `
    SELECT id, hit_rules FROM detection_records
    WHERE rule_set_id = ? AND created_at >= ?
  `;

  const beforeRecords = db
    .prepare(beforeRuleSql)
    .all(version.rule_set_id, version.activated_at);
  const afterRecords = db
    .prepare(afterRuleSql)
    .all(version.rule_set_id, version.activated_at);

  const countRuleHits = (records) => {
    const hitMap = {};
    for (const record of records) {
      const rules = JSON.parse(record.hit_rules);
      for (const rule of rules) {
        if (!hitMap[rule.code]) {
          hitMap[rule.code] = {
            code: rule.code,
            name: rule.name,
            dimension: rule.dimension,
            severity: rule.severity,
            hit_count: 0,
          };
        }
        hitMap[rule.code].hit_count++;
      }
    }
    return hitMap;
  };

  const beforeHits = countRuleHits(beforeRecords);
  const afterHits = countRuleHits(afterRecords);

  const allCodes = new Set([
    ...Object.keys(beforeHits),
    ...Object.keys(afterHits),
  ]);
  const ruleChanges = [];

  for (const code of allCodes) {
    const before = beforeHits[code] || {
      hit_count: 0,
      name: code,
      dimension: "",
      severity: "",
    };
    const after = afterHits[code] || {
      hit_count: 0,
      name: code,
      dimension: "",
      severity: "",
    };
    const beforeRate =
      beforeRecords.length > 0
        ? (before.hit_count / beforeRecords.length) * 100
        : 0;
    const afterRate =
      afterRecords.length > 0
        ? (after.hit_count / afterRecords.length) * 100
        : 0;

    ruleChanges.push({
      code,
      name: after.name || before.name,
      dimension: after.dimension || before.dimension,
      severity: after.severity || before.severity,
      before_hit_count: before.hit_count,
      after_hit_count: after.hit_count,
      hit_count_change: after.hit_count - before.hit_count,
      before_hit_rate: Number(beforeRate.toFixed(2)),
      after_hit_rate: Number(afterRate.toFixed(2)),
      hit_rate_change: Number((afterRate - beforeRate).toFixed(2)),
    });
  }

  ruleChanges.sort(
    (a, b) => Math.abs(b.hit_count_change) - Math.abs(a.hit_count_change),
  );

  res.json({
    code: 0,
    data: {
      version: {
        id: version.id,
        version_number: version.version_number,
        name: version.name,
        status: version.status,
        activated_at: version.activated_at,
        activated_date: new Date(version.activated_at * 1000)
          .toISOString()
          .split("T")[0],
      },
      before: beforeData,
      after: afterData,
      diff: diff,
      rule_changes: ruleChanges,
      before_sample_size: beforeRecords.length,
      after_sample_size: afterRecords.length,
    },
  });
});

router.get("/version-comparison", (req, res) => {
  const { rule_set_id } = req.query;

  if (!rule_set_id) {
    return res.json({ code: 400, message: "请指定规则集ID" });
  }

  const versions = db
    .prepare(
      `
    SELECT * FROM rule_set_versions
    WHERE rule_set_id = ? AND status IN ('active', 'archived')
    ORDER BY version_number DESC
  `,
    )
    .all(rule_set_id);

  if (versions.length === 0) {
    return res.json({ code: 404, message: "该规则集没有已启用过的版本" });
  }

  const versionStats = [];

  for (const version of versions) {
    if (!version.activated_at) continue;

    const sql = `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN level = 'compliant' THEN 1 ELSE 0 END) as compliant,
        SUM(CASE WHEN level = 'suspicious' THEN 1 ELSE 0 END) as suspicious,
        SUM(CASE WHEN level = 'violation' THEN 1 ELSE 0 END) as violation,
        AVG(total_score) as avg_score
      FROM detection_records
      WHERE rule_set_id = ? AND created_at >= ?
      AND (
        SELECT COALESCE(MIN(activated_at), strftime('%s', 'now'))
        FROM rule_set_versions
        WHERE rule_set_id = ? AND status IN ('active', 'archived') AND activated_at > ?
      ) > created_at
    `;

    const stats = db
      .prepare(sql)
      .get(
        rule_set_id,
        version.activated_at,
        rule_set_id,
        version.activated_at,
      );

    if (stats && stats.total > 0) {
      versionStats.push({
        version_id: version.id,
        version_number: version.version_number,
        version_name: version.name,
        activated_at: version.activated_at,
        total: stats.total,
        compliant: stats.compliant,
        suspicious: stats.suspicious,
        violation: stats.violation,
        avg_score: Number(stats.avg_score.toFixed(2)),
        violation_rate:
          stats.total > 0
            ? Number(((stats.violation / stats.total) * 100).toFixed(2))
            : 0,
        compliant_rate:
          stats.total > 0
            ? Number(((stats.compliant / stats.total) * 100).toFixed(2))
            : 0,
      });
    }
  }

  versionStats.sort((a, b) => a.version_number - b.version_number);

  res.json({
    code: 0,
    data: {
      rule_set_id: parseInt(rule_set_id),
      versions: versionStats,
      version_count: versionStats.length,
    },
  });
});

module.exports = router;
