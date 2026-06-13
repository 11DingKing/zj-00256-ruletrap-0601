const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { DEFAULT_LEVEL_THRESHOLDS } = require("../config/ruleConfig");

const dataDir = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "ruletrap.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS rule_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category_code TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (category_code) REFERENCES app_categories(code)
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_set_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      dimension TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      unit TEXT,
      weight INTEGER NOT NULL DEFAULT 10,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      severity TEXT NOT NULL DEFAULT 'violation',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE CASCADE,
      UNIQUE(rule_set_id, code)
    );

    CREATE TABLE IF NOT EXISTS rule_set_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_set_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      activated_at INTEGER,
      created_by TEXT,
      change_log TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE CASCADE,
      UNIQUE(rule_set_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS rule_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_set_version_id INTEGER NOT NULL,
      rule_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      dimension TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      unit TEXT,
      weight INTEGER NOT NULL DEFAULT 10,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      severity TEXT NOT NULL DEFAULT 'violation',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (rule_set_version_id) REFERENCES rule_set_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shadow_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_set_id INTEGER NOT NULL,
      baseline_version_id INTEGER NOT NULL,
      candidate_version_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sample_count INTEGER NOT NULL DEFAULT 0,
      diff_count INTEGER NOT NULL DEFAULT 0,
      result_summary TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE CASCADE,
      FOREIGN KEY (baseline_version_id) REFERENCES rule_set_versions(id),
      FOREIGN KEY (candidate_version_id) REFERENCES rule_set_versions(id)
    );

    CREATE TABLE IF NOT EXISTS shadow_evaluation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id INTEGER NOT NULL,
      detection_record_id INTEGER NOT NULL,
      baseline_total_score REAL NOT NULL,
      baseline_level TEXT NOT NULL,
      baseline_hit_rules TEXT NOT NULL,
      candidate_total_score REAL NOT NULL,
      candidate_level TEXT NOT NULL,
      candidate_hit_rules TEXT NOT NULL,
      has_diff INTEGER NOT NULL DEFAULT 0,
      diff_details TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (evaluation_id) REFERENCES shadow_evaluations(id) ON DELETE CASCADE,
      FOREIGN KEY (detection_record_id) REFERENCES detection_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS detection_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      app_name TEXT,
      category_code TEXT NOT NULL,
      rule_set_id INTEGER NOT NULL,
      rule_set_version_id INTEGER,
      total_score REAL NOT NULL DEFAULT 0,
      level TEXT NOT NULL,
      metrics TEXT NOT NULL,
      hit_rules TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id),
      FOREIGN KEY (rule_set_version_id) REFERENCES rule_set_versions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_detection_app ON detection_records(app_id);
    CREATE INDEX IF NOT EXISTS idx_detection_category ON detection_records(category_code);
    CREATE INDEX IF NOT EXISTS idx_detection_level ON detection_records(level);
    CREATE INDEX IF NOT EXISTS idx_detection_version ON detection_records(rule_set_version_id);
    CREATE INDEX IF NOT EXISTS idx_rules_set ON rules(rule_set_id);
    CREATE INDEX IF NOT EXISTS idx_rs_versions ON rule_set_versions(rule_set_id);
    CREATE INDEX IF NOT EXISTS idx_rule_versions ON rule_versions(rule_set_version_id);
    CREATE INDEX IF NOT EXISTS idx_shadow_eval ON shadow_evaluations(rule_set_id);
    CREATE INDEX IF NOT EXISTS idx_shadow_results ON shadow_evaluation_results(evaluation_id);

    CREATE TABLE IF NOT EXISTS level_thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suspicious REAL NOT NULL,
      violation REAL NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function seedDefaultThresholds() {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM level_thresholds").get();
  if (row.cnt === 0) {
    db.prepare(
      "INSERT INTO level_thresholds (suspicious, violation) VALUES (?, ?)",
    ).run(
      DEFAULT_LEVEL_THRESHOLDS.suspicious,
      DEFAULT_LEVEL_THRESHOLDS.violation,
    );
  }
}

function getLevelThresholds() {
  const row = db
    .prepare(
      "SELECT suspicious, violation FROM level_thresholds ORDER BY id DESC LIMIT 1",
    )
    .get();
  if (row) return { suspicious: row.suspicious, violation: row.violation };
  return { ...DEFAULT_LEVEL_THRESHOLDS };
}

function setLevelThresholds({ suspicious, violation }) {
  const sNum = Number(suspicious);
  const vNum = Number(violation);
  if (isNaN(sNum) || isNaN(vNum)) {
    throw new Error("suspicious 和 violation 必须是有效数字");
  }
  if (sNum < 0 || vNum < 0) {
    throw new Error("阈值不能为负数");
  }
  if (vNum <= sNum) {
    throw new Error("violation 阈值必须大于 suspicious 阈值");
  }
  db.prepare(
    "INSERT INTO level_thresholds (suspicious, violation, updated_at) VALUES (?, ?, strftime('%s', 'now'))",
  ).run(sNum, vNum);
  return { suspicious: sNum, violation: vNum };
}

module.exports = {
  db,
  initTables,
  seedDefaultThresholds,
  getLevelThresholds,
  setLevelThresholds,
};
