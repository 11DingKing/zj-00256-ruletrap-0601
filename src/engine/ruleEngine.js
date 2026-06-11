const OPERATORS = {
  lt: (value, threshold) => value < threshold,
  lte: (value, threshold) => value <= threshold,
  gt: (value, threshold) => value > threshold,
  gte: (value, threshold) => value >= threshold,
  eq: (value, threshold) => value === threshold,
  neq: (value, threshold) => value !== threshold,
};

const LEVEL_THRESHOLDS = {
  suspicious: 15,
  violation: 40,
};

function evaluateRule(rule, metrics) {
  const value = metrics[rule.dimension];
  if (value === undefined || value === null) {
    return { hit: false, reason: "metric_not_found" };
  }

  const op = OPERATORS[rule.operator];
  if (!op) {
    return { hit: false, reason: "invalid_operator" };
  }

  const hit = op(value, rule.threshold);
  return {
    hit,
    value,
    threshold: rule.threshold,
    operator: rule.operator,
    weight: rule.weight,
    severity: rule.severity,
  };
}

function runEngine(metrics, rules) {
  const enabledRules = rules.filter((r) => r.is_enabled === 1);
  const hitRules = [];
  let totalScore = 0;

  for (const rule of enabledRules) {
    const result = evaluateRule(rule, metrics);
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

  let level = "compliant";
  if (totalScore >= LEVEL_THRESHOLDS.violation) {
    level = "violation";
  } else if (totalScore >= LEVEL_THRESHOLDS.suspicious) {
    level = "suspicious";
  }

  return {
    totalScore,
    level,
    hitRules,
    totalRulesChecked: enabledRules.length,
    hitCount: hitRules.length,
    levelThresholds: LEVEL_THRESHOLDS,
  };
}

module.exports = { runEngine, evaluateRule, LEVEL_THRESHOLDS };
