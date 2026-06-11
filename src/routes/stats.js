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
      level_distribution: levelMap,
      violation_rate: violationRate,
    },
  });
});

module.exports = router;
