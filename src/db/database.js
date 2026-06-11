const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'ruletrap.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

    CREATE TABLE IF NOT EXISTS detection_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      app_name TEXT,
      category_code TEXT NOT NULL,
      rule_set_id INTEGER NOT NULL,
      total_score REAL NOT NULL DEFAULT 0,
      level TEXT NOT NULL,
      metrics TEXT NOT NULL,
      hit_rules TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_detection_app ON detection_records(app_id);
    CREATE INDEX IF NOT EXISTS idx_detection_category ON detection_records(category_code);
    CREATE INDEX IF NOT EXISTS idx_detection_level ON detection_records(level);
    CREATE INDEX IF NOT EXISTS idx_rules_set ON rules(rule_set_id);
  `);
}

module.exports = { db, initTables };
