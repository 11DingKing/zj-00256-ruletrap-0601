const express = require("express");
const path = require("path");
const fs = require("fs");
const { initTables, db, seedDefaultThresholds } = require("./db/database");
const { seedDefaultData, SAMPLE_DETECTIONS } = require("./data/seed");
const { runEngine } = require("./engine/ruleEngine");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

initTables();
seedDefaultThresholds();
const { DEFAULT_CATEGORIES } = seedDefaultData();

function seedSampleDetections() {
  const count = db
    .prepare("SELECT COUNT(*) as cnt FROM detection_records")
    .get().cnt;
  if (count > 0) return;

  const { getActiveVersionId } = require("./routes/versions");

  for (const sample of SAMPLE_DETECTIONS) {
    const ruleSet = db
      .prepare(
        `
      SELECT rs.id FROM rule_sets rs
      WHERE rs.category_code = ? AND rs.is_default = 1
      LIMIT 1
    `,
      )
      .get(sample.category_code);

    if (!ruleSet) continue;

    const activeVersionId = getActiveVersionId(ruleSet.id);

    const rules = db
      .prepare("SELECT * FROM rules WHERE rule_set_id = ?")
      .all(ruleSet.id);
    const result = runEngine(sample.metrics, rules);

    db.prepare(
      `
      INSERT INTO detection_records (app_id, app_name, category_code, rule_set_id, rule_set_version_id, total_score, level, metrics, hit_rules)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      sample.app_id,
      sample.app_name,
      sample.category_code,
      ruleSet.id,
      activeVersionId,
      result.totalScore,
      result.level,
      JSON.stringify(sample.metrics),
      JSON.stringify(result.hitRules),
    );
  }
}

seedSampleDetections();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use("/api/rules", require("./routes/rules"));
app.use("/api/detection", require("./routes/detection"));
app.use("/api/stats", require("./routes/stats"));
app.use("/api/versions", require("./routes/versions").router);
app.use("/api/shadow", require("./routes/shadow"));

app.get("/api/health", (req, res) => {
  res.json({
    code: 0,
    data: { status: "ok", timestamp: Math.floor(Date.now() / 1000) },
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "RuleTrap Compliance Engine",
    version: "1.0.0",
    description: "App开屏页合规规则引擎服务",
    endpoints: {
      rules: "/api/rules",
      detection: "/api/detection",
      stats: "/api/stats",
      health: "/api/health",
    },
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 RuleTrap 合规规则引擎已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`\n📋 内置数据:`);
  console.log(`   - 应用类别: ${DEFAULT_CATEGORIES.length} 个`);
  const ruleCount = db.prepare("SELECT COUNT(*) as cnt FROM rules").get().cnt;
  const recordCount = db
    .prepare("SELECT COUNT(*) as cnt FROM detection_records")
    .get().cnt;
  console.log(`   - 合规规则: ${ruleCount} 条`);
  console.log(`   - 检测记录: ${recordCount} 条`);
  console.log(`\n🔧 API 接口:`);
  console.log(`   GET  /api/health              - 健康检查`);
  console.log(
    `   GET  /api/rules/meta          - 规则元数据(维度/操作符/严重级别)`,
  );
  console.log(`   GET  /api/rules/categories    - 应用类别列表`);
  console.log(`   GET  /api/rules/rule-sets     - 规则集列表`);
  console.log(`   GET  /api/rules/rule-sets/:id - 规则集详情(含规则)`);
  console.log(`   GET  /api/rules/rules         - 规则列表`);
  console.log(`   POST /api/rules/rules         - 新增规则`);
  console.log(`   PUT  /api/rules/rules/:id     - 修改规则`);
  console.log(`   PATCH /api/rules/rules/:id/toggle - 启停规则`);
  console.log(`   DELETE /api/rules/rules/:id   - 删除规则`);
  console.log(`   GET  /api/rules/level-thresholds  - 获取档位阈值`);
  console.log(`   PUT  /api/rules/level-thresholds  - 设置档位阈值`);
  console.log(`   POST /api/detection/detect    - 提交检测`);
  console.log(`   GET  /api/detection/records   - 检测记录列表`);
  console.log(`   GET  /api/stats/overview      - 总览统计`);
  console.log(`   GET  /api/stats/level-distribution  - 违规档位分布`);
  console.log(`   GET  /api/stats/rule-hit-frequency  - 规则命中频次`);
  console.log(`   GET  /api/stats/category-summary    - 分类汇总`);
  console.log(`   GET  /api/stats/version-detection-trend - 版本检出趋势`);
  console.log(`   GET  /api/stats/version-impact      - 版本上线影响`);
  console.log(`   GET  /api/stats/version-comparison   - 版本间对比`);
  console.log(`   ---`);
  console.log(
    `   GET  /api/versions/rule-sets/:id/versions         - 版本列表`,
  );
  console.log(
    `   GET  /api/versions/rule-sets/:id/versions/active  - 当前启用版本`,
  );
  console.log(
    `   POST /api/versions/rule-sets/:id/versions         - 创建版本快照`,
  );
  console.log(
    `   POST /api/versions/rule-sets/:id/versions/:vid/activate - 启用版本`,
  );
  console.log(
    `   POST /api/versions/rule-sets/:id/versions/:vid/rollback  - 回滚版本`,
  );
  console.log(
    `   GET  /api/versions/rule-sets/:id/versions/compare - 版本配置对比`,
  );
  console.log(
    `   POST /api/versions/rule-sets/:id/versions/:vid/preview-detect - 试算检测`,
  );
  console.log(`   ---`);
  console.log(`   GET  /api/shadow/evaluations        - 影子评测列表`);
  console.log(`   POST /api/shadow/evaluations        - 创建影子评测`);
  console.log(`   POST /api/shadow/evaluations/:id/run - 重新执行评测`);
  console.log(`   GET  /api/shadow/evaluations/:id    - 评测详情`);
  console.log(
    `   GET  /api/shadow/evaluations/:id/results      - 评测结果列表`,
  );
  console.log(
    `   GET  /api/shadow/evaluations/:id/diff-summary - 评测差异汇总`,
  );
  console.log();
});

module.exports = app;
