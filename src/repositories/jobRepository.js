const db = require("../database/database");

const insertJob = db.prepare(`
    INSERT INTO jobs(
      id,
      command,
      state,
      attempts,
      max_retries,
      created_at,
      updated_at
    )
    VALUES(?,?,?,?,?,?,?)
`);

function createJob(job) {
  insertJob.run(
    job.id,
    job.command,
    job.state,
    job.attempts,
    job.max_retries,
    job.created_at,
    job.updated_at
  );
}

const getAllJobs = db.prepare(`
    SELECT * FROM jobs ORDER BY created_at DESC
`);

function listJobs() {
  return getAllJobs.all();
}

const getJobById = db.prepare(`
    SELECT * FROM jobs WHERE id=?;
`);

function findJobById(id) {
  return getJobById.get(id);
}

const claimJobAtomic = db.transaction((workerId, nowStr) => {
  const job = db.prepare(`
    SELECT * FROM jobs
    WHERE state = 'pending'
       OR (state = 'failed' AND next_retry_at <= ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(nowStr);

  if (!job) return null;

  const result = db.prepare(`
    UPDATE jobs
    SET state = 'processing',
        worker_id = ?,
        updated_at = ?,
        last_heartbeat = ?
    WHERE id = ? AND (state = 'pending' OR (state = 'failed' AND next_retry_at <= ?))
  `).run(workerId, nowStr, nowStr, job.id, nowStr);

  if (result.changes === 1) {
    job.state = 'processing';
    job.worker_id = workerId;
    job.updated_at = nowStr;
    job.last_heartbeat = nowStr;
    return job;
  }
  return null;
});

function markJobCompleted(id) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE jobs
    SET state = 'completed', worker_id = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, id);
}

function markJobFailed(id, attempts, nextRetryAt, errorMsg) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE jobs
    SET state = 'failed',
        attempts = ?,
        next_retry_at = ?,
        last_error = ?,
        worker_id = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(attempts, nextRetryAt, errorMsg, now, id);
}

function markJobDead(id, attempts, errorMsg) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE jobs
    SET state = 'dead',
        attempts = ?,
        last_error = ?,
        worker_id = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(attempts, errorMsg, now, id);
}

function updateJobHeartbeat(id) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE jobs
    SET last_heartbeat = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

function retryJobFromDLQ(id) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE jobs
    SET state = 'pending',
        attempts = 0,
        last_error = NULL,
        worker_id = NULL,
        next_retry_at = NULL,
        last_heartbeat = NULL,
        updated_at = ?
    WHERE id = ? AND state = 'dead'
  `).run(now, id);
  return result.changes === 1;
}

module.exports = {
  createJob,
  listJobs,
  findJobById,
  claimJobAtomic,
  markJobCompleted,
  markJobFailed,
  markJobDead,
  updateJobHeartbeat,
  retryJobFromDLQ,
};

