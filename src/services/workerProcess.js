const { exec } = require("child_process");
const db = require("../database/database");
const { claimJobAtomic, markJobCompleted, markJobFailed, markJobDead, updateJobHeartbeat } = require("../repositories/jobRepository");
const { registerWorker, updateWorkerHeartbeat, updateWorkerStatus, deregisterWorker } = require("../repositories/workerRepository");
const { getConfig } = require("../repositories/configRepository");

const workerId = process.argv[2] || `worker-${process.pid}-${Date.now()}`;
const pid = process.pid;

const initializeDatabase = require("../database/schema");
initializeDatabase();

let currentJob = null;
let isShuttingDown = false;
let heartbeatInterval = null;

function gracefulExit() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearInterval(heartbeatInterval);
  
  if (currentJob) {
    console.log(`[Worker ${workerId}] Shutdown requested. Finishing current job: ${currentJob.id}...`);
  } else {
    console.log(`[Worker ${workerId}] Shutdown requested. Exiting immediately.`);
    try {
      deregisterWorker(workerId);
    } catch (err) {}
    process.exit(0);
  }
}

process.on("SIGINT", gracefulExit);
process.on("SIGTERM", gracefulExit);

async function startWorker() {
  console.log(`[Worker ${workerId}] Started with PID ${pid}`);
  
  try {
    registerWorker({
      id: workerId,
      pid: pid,
      status: "active",
      last_seen: new Date().toISOString(),
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[Worker ${workerId}] Failed to register worker:`, err.message);
  }

  recoverCrashedJobs();

  heartbeatInterval = setInterval(() => {
    try {
      const globalShutdown = getConfig("shutdown_requested");
      const localStatus = db.prepare("SELECT status FROM workers WHERE id = ?").get(workerId)?.status;
      
      if (globalShutdown === "true" || localStatus === "stopping") {
        gracefulExit();
        return;
      }
      
      updateWorkerHeartbeat(workerId);
      
      if (currentJob) {
        updateJobHeartbeat(currentJob.id);
      }

      recoverCrashedJobs();
    } catch (err) {
      console.error(`[Worker ${workerId}] Heartbeat error:`, err.message);
    }
  }, 5000);

  while (!isShuttingDown) {
    try {
      const globalShutdown = getConfig("shutdown_requested");
      const localStatus = db.prepare("SELECT status FROM workers WHERE id = ?").get(workerId)?.status;
      if (globalShutdown === "true" || localStatus === "stopping") {
        break;
      }

      const nowStr = new Date().toISOString();
      const job = claimJobAtomic(workerId, nowStr);

      if (job) {
        currentJob = job;
        console.log(`[Worker ${workerId}] Claimed job: ${job.id} - Command: "${job.command}"`);

        try {
          await executeJob(job);
        } catch (err) {
          console.error(`[Worker ${workerId}] Execution failed for job ${job.id}:`, err);
        }

        currentJob = null;
        
        if (isShuttingDown) {
          break;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`[Worker ${workerId}] Loop error:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  try {
    deregisterWorker(workerId);
  } catch (err) {}
  console.log(`[Worker ${workerId}] Stopped successfully.`);
  process.exit(0);
}

function executeJob(job) {
  return new Promise((resolve) => {
    exec(job.command, (error, stdout, stderr) => {
      try {
        if (error) {
          const errorMsg = error.message || stderr || "Execution returned non-zero exit code";
          const attempts = job.attempts + 1;
          const maxRetries = job.max_retries;
          const backoffBase = parseFloat(getConfig("backoff_base") || "2");
          
          if (attempts >= maxRetries) {
            console.log(`[Worker ${workerId}] Job ${job.id} failed after ${attempts}/${maxRetries} attempts. Moving to DLQ.`);
            markJobDead(job.id, attempts, errorMsg);
          } else {
            const delay = Math.pow(backoffBase, attempts);
            const nextRetryTime = new Date(Date.now() + delay * 1000).toISOString();
            console.log(`[Worker ${workerId}] Job ${job.id} failed. Retrying after ${delay}s (at ${nextRetryTime}).`);
            markJobFailed(job.id, attempts, nextRetryTime, errorMsg);
          }
        } else {
          console.log(`[Worker ${workerId}] Job ${job.id} completed successfully.`);
          markJobCompleted(job.id);
        }
      } catch (err) {
        console.error(`[Worker ${workerId}] Error writing job result:`, err.message);
      }
      resolve();
    });
  });
}

function recoverCrashedJobs() {
  try {
    const now = new Date();
    const heartbeatThreshold = new Date(now.getTime() - 15 * 1000).toISOString();

    const processingJobs = db.prepare("SELECT * FROM jobs WHERE state = 'processing'").all();

    for (const job of processingJobs) {
      let isDead = false;
      if (!job.worker_id) {
        isDead = true;
      } else {
        const worker = db.prepare("SELECT * FROM workers WHERE id = ?").get(job.worker_id);
        if (!worker) {
          isDead = true;
        } else {
          const workerLastSeen = new Date(worker.last_seen);
          if (now.getTime() - workerLastSeen.getTime() > 15000) {
            isDead = true;
          } else {
            try {
              process.kill(worker.pid, 0);
            } catch (err) {
              if (err.code === "ESRCH") {
                isDead = true;
              }
            }
          }
        }
      }

      if (isDead) {
        console.log(`[Recovery] Detected crashed worker for job ${job.id}. Recovering job...`);
        const attempts = job.attempts + 1;
        const maxRetries = job.max_retries;
        const backoffBase = parseFloat(getConfig("backoff_base") || "2");
        const nextRetryTime = new Date(Date.now() + Math.pow(backoffBase, attempts) * 1000).toISOString();

        if (attempts >= maxRetries) {
          db.prepare(`
            UPDATE jobs 
            SET state = 'dead', attempts = ?, last_error = ?, worker_id = NULL, updated_at = ?
            WHERE id = ? AND state = 'processing' AND worker_id = ?
          `).run(attempts, "Worker crashed during execution", now.toISOString(), job.id, job.worker_id);
        } else {
          db.prepare(`
            UPDATE jobs 
            SET state = 'failed', attempts = ?, next_retry_at = ?, last_error = ?, worker_id = NULL, updated_at = ?
            WHERE id = ? AND state = 'processing' AND worker_id = ?
          `).run(attempts, nextRetryTime, "Worker crashed during execution", now.toISOString(), job.id, job.worker_id);
        }

        if (job.worker_id) {
          deregisterWorker(job.worker_id);
        }
      }
    }
  } catch (err) {
    console.error("[Recovery] Error running recovery:", err.message);
  }
}

startWorker();
