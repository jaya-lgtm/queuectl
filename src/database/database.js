const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../../queue.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs(
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    worker_id TEXT,
    next_retry_at TEXT,
    last_heartbeat TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workers(
    id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL,
    status TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    started_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const insertConfig = db.prepare(`
  INSERT OR IGNORE INTO config(key, value)
  VALUES(?, ?)
`);

insertConfig.run("max_retries", "3");
insertConfig.run("backoff_base", "2");
insertConfig.run("shutdown_requested", "false");

module.exports = db;
