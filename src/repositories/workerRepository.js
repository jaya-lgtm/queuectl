const db = require("../database/database");

function registerWorker(worker) {
  db.prepare(`
    INSERT INTO workers (id, pid, status, last_seen, started_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    worker.id,
    worker.pid,
    worker.status,
    worker.last_seen,
    worker.started_at
  );
}

function updateWorkerHeartbeat(workerId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE workers
    SET last_seen = ?
    WHERE id = ?
  `).run(now, workerId);
}

function updateWorkerStatus(workerId, status) {
  db.prepare(`
    UPDATE workers
    SET status = ?
    WHERE id = ?
  `).run(status, workerId);
}

function deregisterWorker(workerId) {
  db.prepare(`
    DELETE FROM workers
    WHERE id = ?
  `).run(workerId);
}

function getActiveWorkers() {
  return db.prepare("SELECT * FROM workers").all();
}

module.exports = {
  registerWorker,
  updateWorkerHeartbeat,
  updateWorkerStatus,
  deregisterWorker,
  getActiveWorkers,
};
