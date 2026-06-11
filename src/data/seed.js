const { db } = require("../db/database");

const DEFAULT_CATEGORIES = [
  { code: "social", name: "社交娱乐", description: "社交、直播、短视频类应用" },
  { code: "shopping", name: "电商购物", description: "电商、购物、团购类应用" },
  { code: "news", name: "资讯阅读", description: "新闻、资讯、阅读类应用" },
  { code: "tools", name: "工具实用", description: "工具、效率、系统类应用" },
  { code: "games", name: "游戏", description: "游戏类应用" },
];

const DEFAULT_RULES = [
  {
    code: "close_btn_area",
    name: "关闭按钮面积",
    description: "关闭按钮可点击区域占屏幕比例过小，用户难以点击",
    dimension: "close_button_area_ratio",
    operator: "lt",
    threshold: 0.02,
    unit: "%",
    weight: 20,
    severity: "violation",
  },
  {
    code: "hot_area_ratio",
    name: "跳转热区占比",
    description: "可点击跳转热区占屏幕比例过大，易误触诱导跳转",
    dimension: "clickable_hot_area_ratio",
    operator: "gt",
    threshold: 0.6,
    unit: "%",
    weight: 25,
    severity: "violation",
  },
  {
    code: "auto_jump_countdown",
    name: "自动跳转倒计时",
    description: "自动跳转倒计时过短，用户来不及阅读和选择",
    dimension: "auto_jump_countdown_seconds",
    operator: "lt",
    threshold: 5,
    unit: "秒",
    weight: 15,
    severity: "warning",
  },
  {
    code: "shake_jump",
    name: "摇一摇跳转",
    description: "是否禁止摇一摇跳转，存在则为诱导跳转",
    dimension: "has_shake_jump",
    operator: "eq",
    threshold: 1,
    unit: "bool",
    weight: 30,
    severity: "violation",
  },
  {
    code: "close_btn_visible_time",
    name: "关闭按钮出现时延",
    description: "关闭按钮出现延迟时间过长，用户需等待才能关闭",
    dimension: "close_button_delay_ms",
    operator: "gt",
    threshold: 3000,
    unit: "毫秒",
    weight: 10,
    severity: "warning",
  },
  {
    code: "fullscreen_jump",
    name: "全屏跳转热区",
    description: "是否整屏均可点击跳转",
    dimension: "is_fullscreen_clickable",
    operator: "eq",
    threshold: 1,
    unit: "bool",
    weight: 35,
    severity: "violation",
  },
  {
    code: "fake_close_buttons",
    name: "虚假关闭按钮数量",
    description: "存在虚假关闭按钮，误导用户点击跳转",
    dimension: "fake_close_button_count",
    operator: "gt",
    threshold: 0,
    unit: "个",
    weight: 25,
    severity: "violation",
  },
];

const SAMPLE_DETECTIONS = [
  {
    app_id: "com.example.social1",
    app_name: "快聊社交",
    category_code: "social",
    metrics: {
      close_button_area_ratio: 0.01,
      clickable_hot_area_ratio: 0.85,
      auto_jump_countdown_seconds: 3,
      has_shake_jump: 1,
      close_button_delay_ms: 2000,
      is_fullscreen_clickable: 0,
      fake_close_button_count: 1,
    },
  },
  {
    app_id: "com.example.shop1",
    app_name: "好物优选",
    category_code: "shopping",
    metrics: {
      close_button_area_ratio: 0.025,
      clickable_hot_area_ratio: 0.45,
      auto_jump_countdown_seconds: 5,
      has_shake_jump: 0,
      close_button_delay_ms: 1500,
      is_fullscreen_clickable: 0,
      fake_close_button_count: 0,
    },
  },
  {
    app_id: "com.example.news1",
    app_name: "今日快看",
    category_code: "news",
    metrics: {
      close_button_area_ratio: 0.008,
      clickable_hot_area_ratio: 0.92,
      auto_jump_countdown_seconds: 2,
      has_shake_jump: 1,
      close_button_delay_ms: 5000,
      is_fullscreen_clickable: 1,
      fake_close_button_count: 2,
    },
  },
  {
    app_id: "com.example.game1",
    app_name: "消消乐园",
    category_code: "games",
    metrics: {
      close_button_area_ratio: 0.015,
      clickable_hot_area_ratio: 0.7,
      auto_jump_countdown_seconds: 4,
      has_shake_jump: 0,
      close_button_delay_ms: 3500,
      is_fullscreen_clickable: 0,
      fake_close_button_count: 0,
    },
  },
  {
    app_id: "com.example.tools1",
    app_name: "清理大师",
    category_code: "tools",
    metrics: {
      close_button_area_ratio: 0.03,
      clickable_hot_area_ratio: 0.3,
      auto_jump_countdown_seconds: 6,
      has_shake_jump: 0,
      close_button_delay_ms: 500,
      is_fullscreen_clickable: 0,
      fake_close_button_count: 0,
    },
  },
];

function seedDefaultData() {
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO app_categories (code, name, description)
    VALUES (?, ?, ?)
  `);

  for (const cat of DEFAULT_CATEGORIES) {
    insertCategory.run(cat.code, cat.name, cat.description);
  }

  const insertRuleSet = db.prepare(`
    INSERT OR IGNORE INTO rule_sets (code, name, description, category_code, is_default)
    VALUES (?, ?, ?, ?, 1)
  `);

  for (const cat of DEFAULT_CATEGORIES) {
    insertRuleSet.run(
      `default_${cat.code}`,
      `${cat.name}默认规则集`,
      `${cat.name}类应用的默认合规规则集`,
      cat.code,
    );
  }

  const ruleSetRow = db
    .prepare("SELECT id FROM rule_sets WHERE is_default = 1 LIMIT 1")
    .get();
  if (ruleSetRow) {
    const allRuleSets = db
      .prepare("SELECT id, category_code FROM rule_sets WHERE is_default = 1")
      .all();

    for (const rs of allRuleSets) {
      const ruleCount = db
        .prepare("SELECT COUNT(*) as cnt FROM rules WHERE rule_set_id = ?")
        .get(rs.id);
      if (ruleCount.cnt === 0) {
        const insertRule = db.prepare(`
          INSERT INTO rules (rule_set_id, code, name, description, dimension, operator, threshold, unit, weight, is_enabled, severity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `);

        for (const rule of DEFAULT_RULES) {
          insertRule.run(
            rs.id,
            rule.code,
            rule.name,
            rule.description,
            rule.dimension,
            rule.operator,
            rule.threshold,
            rule.unit,
            rule.weight,
            rule.severity,
          );
        }
      }
    }
  }

  return { DEFAULT_CATEGORIES, DEFAULT_RULES, SAMPLE_DETECTIONS };
}

module.exports = {
  seedDefaultData,
  SAMPLE_DETECTIONS,
  DEFAULT_RULES,
  DEFAULT_CATEGORIES,
};
