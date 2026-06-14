const {
  DIMENSION_META,
  normalizeMetricValue,
  normalizeThreshold,
} = require("../config/ruleConfig");
const { getLevelThresholds } = require("../db/database");
const { getMatcher, getMatcherKeys } = require("./matchers");
const { classifyLevel } = require("./LevelClassifier");

function evaluateRule(rule, metrics) {
  const dimensionMeta = DIMENSION_META[rule.dimension];
  const isBool = dimensionMeta && dimensionMeta.type === "boolean";

  const rawValue = metrics[rule.dimension];
  if (rawValue === undefined || rawValue === null) {
    return { hit: false, reason: "metric_not_found" };
  }

  const value = normalizeMetricValue(rule.dimension, rawValue);

  const matcher = getMatcher(rule.operator);
  if (!matcher) {
    return {
      hit: false,
      reason: "invalid_operator",
      error: `操作符 ${rule.operator} 未在引擎中注册，请使用 ${getMatcherKeys().join("/")}`,
    };
  }

  let threshold = rule.threshold;
  if (isBool) {
    const norm = normalizeThreshold(rule.dimension, threshold);
    if (!norm.ok) {
      return { hit: false, reason: "invalid_threshold", error: norm.error };
    }
    threshold = norm.value;
  }

  const hit = matcher.match(value, threshold);
  return {
    hit,
    value,
    threshold,
    operator: rule.operator,
    weight: rule.weight,
    severity: rule.severity,
  };
}

function runEngine(metrics, rules, options) {
  const thresholds =
    options && options.levelThresholds
      ? options.levelThresholds
      : getLevelThresholds();

  const enabledRules = rules.filter((r) => r.is_enabled === 1);
  const hitRules = [];
  const invalidRules = [];
  let totalScore = 0;

  for (const rule of enabledRules) {
    const result = evaluateRule(rule, metrics);
    if (result.error) {
      invalidRules.push({
        id: rule.id,
        code: rule.code,
        name: rule.name,
        reason: result.reason,
        error: result.error,
      });
      continue;
    }
    if (result.hit) {
      hitRules.push({
        id: rule.id,
        code: rule.code,
        name: rule.name,
        description: rule.description,
        dimension: rule.dimension,
        ...result,
      });
      totalScore += rule.weight;
    }
  }

  const level = classifyLevel(totalScore, thresholds);

  return {
    totalScore,
    level,
    hitRules,
    totalRulesChecked: enabledRules.length,
    hitCount: hitRules.length,
    invalidRuleCount: invalidRules.length,
    invalidRules,
    levelThresholds: thresholds,
  };
}

module.exports = { runEngine, evaluateRule };
