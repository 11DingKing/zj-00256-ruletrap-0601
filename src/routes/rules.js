const express = require("express");
const {
  db,
  getLevelThresholds,
  setLevelThresholds,
} = require("../db/database");
const {
  validateRuleInput,
  normalizeThreshold,
  DIMENSION_META,
  VALID_OPERATORS,
  VALID_OPERATOR_KEYS,
  VALID_SEVERITIES,
} = require("../config/ruleConfig");

const router = express.Router();

router.get("/meta", (req, res) => {
  res.json({
    code: 0,
    data: {
      dimensions: Object.entries(DIMENSION_META).map(([key, meta]) => ({
        key,
        ...meta,
      })),
      operators: VALID_OPERATOR_KEYS.map((k) => ({
        key: k,
        label: VALID_OPERATORS[k].label,
      })),
      severities: VALID_SEVERITIES,
    },
  });
});

router.get("/categories", (req, res) => {
  const categories = db
    .prepare("SELECT * FROM app_categories ORDER BY id")
    .all();
  res.json({ code: 0, data: categories });
});

router.get("/rule-sets", (req, res) => {
  const { category_code } = req.query;
  let sql = "SELECT * FROM rule_sets";
  const params = [];
  if (category_code) {
    sql += " WHERE category_code = ?";
    params.push(category_code);
  }
  sql += " ORDER BY id";
  const ruleSets = db.prepare(sql).all(...params);
  res.json({ code: 0, data: ruleSets });
});

router.get("/rule-sets/:id", (req, res) => {
  const ruleSet = db
    .prepare("SELECT * FROM rule_sets WHERE id = ?")
    .get(req.params.id);
  if (!ruleSet) {
    return res.json({ code: 404, message: "规则集不存在" });
  }
  const rules = db
    .prepare("SELECT * FROM rules WHERE rule_set_id = ? ORDER BY id")
    .all(req.params.id);
  res.json({ code: 0, data: { ...ruleSet, rules } });
});

router.get("/rules", (req, res) => {
  const { rule_set_id, is_enabled } = req.query;
  let sql = "SELECT * FROM rules WHERE 1=1";
  const params = [];
  if (rule_set_id) {
    sql += " AND rule_set_id = ?";
    params.push(rule_set_id);
  }
  if (is_enabled !== undefined) {
    sql += " AND is_enabled = ?";
    params.push(is_enabled);
  }
  sql += " ORDER BY id";
  const rules = db.prepare(sql).all(...params);
  res.json({ code: 0, data: rules });
});

router.get("/rules/:id", (req, res) => {
  const rule = db
    .prepare("SELECT * FROM rules WHERE id = ?")
    .get(req.params.id);
  if (!rule) {
    return res.json({ code: 404, message: "规则不存在" });
  }
  res.json({ code: 0, data: rule });
});

router.post("/rules", (req, res) => {
  const {
    rule_set_id,
    code,
    name,
    description,
    dimension,
    operator,
    threshold,
    unit,
    weight,
    is_enabled,
    severity,
  } = req.body;

  if (!rule_set_id || !code || !name) {
    return res.json({ code: 400, message: "缺少必要参数：rule_set_id, code, name" });
  }

  const validationErrors = validateRuleInput({
    dimension,
    operator,
    threshold,
    severity,
    weight,
  });
  if (validationErrors.length > 0) {
    return res.json({
      code: 400,
      message: "规则参数校验失败",
      errors: validationErrors,
    });
  }

  let normalizedThreshold = threshold;
  const normResult = normalizeThreshold(dimension, threshold);
  if (normResult.ok) {
    normalizedThreshold = normResult.value;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO rules (rule_set_id, code, name, description, dimension, operator, threshold, unit, weight, is_enabled, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      rule_set_id,
      code,
      name,
      description || "",
      dimension,
      operator,
      normalizedThreshold,
      unit || (DIMENSION_META[dimension]?.unit || ""),
      weight !== undefined ? weight : 10,
      is_enabled !== undefined ? is_enabled : 1,
      severity || "violation",
    );
    const rule = db
      .prepare("SELECT * FROM rules WHERE id = ?")
      .get(result.lastInsertRowid);
    res.json({ code: 0, data: rule });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

router.put("/rules/:id", (req, res) => {
  const rule = db
    .prepare("SELECT * FROM rules WHERE id = ?")
    .get(req.params.id);
  if (!rule) {
    return res.json({ code: 404, message: "规则不存在" });
  }

  const merged = {
    dimension: req.body.dimension !== undefined ? req.body.dimension : rule.dimension,
    operator: req.body.operator !== undefined ? req.body.operator : rule.operator,
    threshold: req.body.threshold !== undefined ? req.body.threshold : rule.threshold,
    severity: req.body.severity !== undefined ? req.body.severity : rule.severity,
    weight: req.body.weight !== undefined ? req.body.weight : rule.weight,
  };

  const validationErrors = validateRuleInput(merged);
  if (validationErrors.length > 0) {
    return res.json({
      code: 400,
      message: "规则参数校验失败",
      errors: validationErrors,
    });
  }

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
  const updates = [];
  const params = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      let value = req.body[field];
      if (field === "threshold") {
        const targetDimension = merged.dimension;
        const norm = normalizeThreshold(targetDimension, value);
        if (norm.ok) value = norm.value;
      }
      updates.push(`${field} = ?`);
      params.push(value);
    }
  }

  if (updates.length === 0) {
    return res.json({ code: 0, data: rule });
  }

  updates.push("updated_at = strftime('%s', 'now')");
  params.push(req.params.id);

  const sql = `UPDATE rules SET ${updates.join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...params);

  const updated = db
    .prepare("SELECT * FROM rules WHERE id = ?")
    .get(req.params.id);
  res.json({ code: 0, data: updated });
});

router.patch("/rules/:id/toggle", (req, res) => {
  const rule = db
    .prepare("SELECT * FROM rules WHERE id = ?")
    .get(req.params.id);
  if (!rule) {
    return res.json({ code: 404, message: "规则不存在" });
  }

  const newEnabled = rule.is_enabled === 1 ? 0 : 1;
  db.prepare(
    "UPDATE rules SET is_enabled = ?, updated_at = strftime('%s', 'now') WHERE id = ?",
  ).run(newEnabled, req.params.id);

  const updated = db
    .prepare("SELECT * FROM rules WHERE id = ?")
    .get(req.params.id);
  res.json({ code: 0, data: updated });
});

router.delete("/rules/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM rules WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) {
    return res.json({ code: 404, message: "规则不存在" });
  }
  res.json({ code: 0, data: { deleted: true } });
});

router.get("/level-thresholds", (req, res) => {
  const thresholds = getLevelThresholds();
  res.json({ code: 0, data: thresholds });
});

router.put("/level-thresholds", (req, res) => {
  const { suspicious, violation } = req.body;
  if (suspicious === undefined || violation === undefined) {
    return res.json({
      code: 400,
      message: "缺少必要参数：suspicious, violation",
    });
  }
  try {
    const updated = setLevelThresholds({ suspicious, violation });
    res.json({ code: 0, data: updated });
  } catch (err) {
    res.json({ code: 400, message: err.message });
  }
});

module.exports = router;
