const VALID_OPERATORS = {
  lt: { label: "小于", fn: (value, threshold) => value < threshold },
  lte: { label: "小于等于", fn: (value, threshold) => value <= threshold },
  gt: { label: "大于", fn: (value, threshold) => value > threshold },
  gte: { label: "大于等于", fn: (value, threshold) => value >= threshold },
  eq: { label: "等于", fn: (value, threshold) => value === threshold },
  neq: { label: "不等于", fn: (value, threshold) => value !== threshold },
};

const VALID_OPERATOR_KEYS = Object.keys(VALID_OPERATORS);

const VALID_SEVERITIES = ["warning", "violation"];

const BOOLEAN_TRUE_VALUES = new Set([
  true,
  1,
  "1",
  "true",
  "TRUE",
  "True",
  "是",
  "yes",
  "YES",
  "Yes",
  "y",
  "Y",
  "on",
  "ON",
]);

const BOOLEAN_FALSE_VALUES = new Set([
  false,
  0,
  "0",
  "false",
  "FALSE",
  "False",
  "否",
  "no",
  "NO",
  "No",
  "n",
  "N",
  "off",
  "OFF",
]);

const DEFAULT_LEVEL_THRESHOLDS = {
  suspicious: 15,
  violation: 40,
};

const DIMENSION_META = {
  close_button_area_ratio: { type: "number", unit: "%", description: "关闭按钮面积占比" },
  clickable_hot_area_ratio: { type: "number", unit: "%", description: "跳转热区占比" },
  auto_jump_countdown_seconds: { type: "number", unit: "秒", description: "自动跳转倒计时" },
  has_shake_jump: { type: "boolean", unit: "bool", description: "是否有摇一摇跳转" },
  close_button_delay_ms: { type: "number", unit: "毫秒", description: "关闭按钮出现时延" },
  is_fullscreen_clickable: { type: "boolean", unit: "bool", description: "是否全屏可点击跳转" },
  fake_close_button_count: { type: "number", unit: "个", description: "虚假关闭按钮数量" },
};

function normalizeBoolean(value) {
  if (value === undefined || value === null) return null;
  if (BOOLEAN_TRUE_VALUES.has(value)) return 1;
  if (BOOLEAN_FALSE_VALUES.has(value)) return 0;
  return null;
}

function isBooleanDimension(dimension) {
  const meta = DIMENSION_META[dimension];
  return meta && meta.type === "boolean";
}

function getDimensionType(dimension) {
  const meta = DIMENSION_META[dimension];
  return meta ? meta.type : "number";
}

function normalizeThreshold(dimension, threshold) {
  if (isBooleanDimension(dimension)) {
    const normalized = normalizeBoolean(threshold);
    if (normalized === null) return { ok: false, error: `维度 ${dimension} 是布尔型，阈值需为 0/1、true/false、是/否 等可识别值` };
    return { ok: true, value: normalized };
  }
  const num = Number(threshold);
  if (isNaN(num)) return { ok: false, error: `维度 ${dimension} 是数值型，阈值需为有效数字` };
  return { ok: true, value: num };
}

function normalizeMetricValue(dimension, value) {
  if (isBooleanDimension(dimension)) {
    const normalized = normalizeBoolean(value);
    return normalized === null ? value : normalized;
  }
  return value;
}

function validateRuleInput({ dimension, operator, threshold, severity, weight }) {
  const errors = [];

  if (!dimension || typeof dimension !== "string") {
    errors.push("dimension 不能为空");
  } else if (!DIMENSION_META[dimension]) {
    errors.push(`未知的检测维度: ${dimension}，可用维度: ${Object.keys(DIMENSION_META).join(", ")}`);
  }

  if (!operator) {
    errors.push("operator 不能为空");
  } else if (!VALID_OPERATORS[operator]) {
    errors.push(`不支持的比对方式: ${operator}，可用操作符: ${VALID_OPERATOR_KEYS.join(", ")} (${VALID_OPERATOR_KEYS.map((k) => VALID_OPERATORS[k].label).join(", ")})`);
  }

  if (dimension && DIMENSION_META[dimension] && isBooleanDimension(dimension)) {
    if (operator && !["eq", "neq"].includes(operator)) {
      errors.push(`布尔型维度 ${dimension} 仅支持 eq / neq 比对方式`);
    }
  }

  if (threshold === undefined || threshold === null || threshold === "") {
    errors.push("threshold 不能为空");
  } else if (dimension && DIMENSION_META[dimension]) {
    const norm = normalizeThreshold(dimension, threshold);
    if (!norm.ok) errors.push(norm.error);
  } else if (isNaN(Number(threshold))) {
    errors.push("threshold 需为有效数字");
  }

  if (severity !== undefined && !VALID_SEVERITIES.includes(severity)) {
    errors.push(`severity 只能是: ${VALID_SEVERITIES.join(", ")}`);
  }

  if (weight !== undefined && (typeof weight !== "number" || weight <= 0 || !Number.isInteger(weight))) {
    errors.push("weight 必须是正整数");
  }

  return errors;
}

module.exports = {
  VALID_OPERATORS,
  VALID_OPERATOR_KEYS,
  VALID_SEVERITIES,
  DEFAULT_LEVEL_THRESHOLDS,
  DIMENSION_META,
  BOOLEAN_TRUE_VALUES,
  BOOLEAN_FALSE_VALUES,
  normalizeBoolean,
  isBooleanDimension,
  getDimensionType,
  normalizeThreshold,
  normalizeMetricValue,
  validateRuleInput,
};
