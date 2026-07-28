const db = require("../database/database");

function getConfig(key) {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare(`
    INSERT INTO config(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getAllConfig() {
  return db.prepare("SELECT * FROM config").all();
}

module.exports = {
  getConfig,
  setConfig,
  getAllConfig,
};
