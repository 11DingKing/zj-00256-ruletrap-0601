const express = require("express");
const { db } = require("../db/database");
const { runEngine } = require("../engine/ruleEngine");

const router = express.Router();

function getDefaultRuleSetId(categoryCode) {
  const row = db
    .prepare(
      `
    SELECT rs.id FROM rule_sets rs
    WHERE rs.category_code = ? AND rs.is_default = 1
    LIMIT 1
  `,
    )
    .get(categoryCode);
  return row ? row.id : null;
}

router.post("/detect", (req, res) => {
  const { app_id, app_name, category_code, metrics, rule_set_id } = req.body;

  if (!app_id || !category_code || !metrics) {
    return res.json({
      code: 400,
      message: "缺少必要参数：app_id, category_code, metrics",
    });
  }

  let targetRuleSetId = rule_set_id;
  if (!targetRuleSetId) {
    targetRuleSetId = getDefaultRuleSetId(category_code);
  }

  if (!targetRuleSetId) {
    return res.json({ code: 400, message: "未找到对应的规则集" });
  }

  const ruleSet = db
    .prepare("SELECT * FROM rule_sets WHERE id = ?")
    .get(targetRuleSetId);
  if (!ruleSet) {
    return res.json({ code: 404, message: "规则集不存在" });
  }

  const rules = db
    .prepare("SELECT * FROM rules WHERE rule_set_id = ?")
    .all(targetRuleSetId);

  const result = runEngine(metrics, rules);

  const insertStmt = db.prepare(`
    INSERT INTO detection_records (app_id, app_name, category_code, rule_set_id, total_score, level, metrics, hit_rules)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResult = insertStmt.run(
    app_id,
    app_name || "",
    category_code,
    targetRuleSetId,
    result.totalScore,
    result.level,
    JSON.stringify(metrics),
    JSON.stringify(result.hitRules),
  );

  res.json({
    code: 0,
    data: {
      record_id: insertResult.lastInsertRowid,
      app_id,
      app_name: app_name || "",
      category_code,
      rule_set: {
        id: ruleSet.id,
        code: ruleSet.code,
        name: ruleSet.name,
      },
      total_score: result.totalScore,
      level: result.level,
      hit_rules: result.hitRules,
      total_rules_checked: result.totalRulesChecked,
      hit_count: result.hitCount,
      level_thresholds: result.levelThresholds,
      metrics,
    },
  });
});

router.get("/records", (req, res) => {
  const { app_id, category_code, level, limit, offset } = req.query;

  let sql = "SELECT * FROM detection_records WHERE 1=1";
  const params = [];

  if (app_id) {
    sql += " AND app_id = ?";
    params.push(app_id);
  }
  if (category_code) {
    sql += " AND category_code = ?";
    params.push(category_code);
  }
  if (level) {
    sql += " AND level = ?";
    params.push(level);
  }

  sql += " ORDER BY created_at DESC";

  const lim = parseInt(limit) || 20;
  const off = parseInt(offset) || 0;
  sql += " LIMIT ? OFFSET ?";
  params.push(lim, off);

  const records = db.prepare(sql).all(...params);
  const parsed = records.map((r) => ({
    ...r,
    metrics: JSON.parse(r.metrics),
    hit_rules: JSON.parse(r.hit_rules),
  }));

  const countSql = sql
    .replace(/SELECT \* FROM/, "SELECT COUNT(*) as cnt FROM")
    .replace(/ ORDER BY.*/, "")
    .replace(/ LIMIT.*/, "");
  const countParams = params.slice(0, params.length - 2);
  const total = db.prepare(countSql).get(...countParams).cnt;

  res.json({ code: 0, data: { list: parsed, total, limit: lim, offset: off } });
});

router.get("/records/:id", (req, res) => {
  const record = db
    .prepare("SELECT * FROM detection_records WHERE id = ?")
    .get(req.params.id);
  if (!record) {
    return res.json({ code: 404, message: "检测记录不存在" });
  }
  record.metrics = JSON.parse(record.metrics);
  record.hit_rules = JSON.parse(record.hit_rules);
  res.json({ code: 0, data: record });
});

module.exports = router;
