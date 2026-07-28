const { getAllJobs } = require("../services/jobServices");
const { getActiveWorkers } = require("../repositories/workerRepository");

function status() {
  const jobs = getAllJobs();
  const workers = getActiveWorkers();

  const counts = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    dead: 0,
  };

  for (const job of jobs) {
    if (counts[job.state] !== undefined) {
      counts[job.state]++;
    }
  }

  console.log("=== QueueCTL Status ===");
  console.log("\nJob States Summary:");
  console.log(`- pending   : ${counts.pending}`);
  console.log(`- processing: ${counts.processing}`);
  console.log(`- completed : ${counts.completed}`);
  console.log(`- failed    : ${counts.failed}`);
  console.log(`- dead (DLQ): ${counts.dead}`);

  console.log("\nActive Workers:");
  const now = Date.now();
  
  const activeWorkers = workers.filter((w) => {
    const timeDiff = now - new Date(w.last_seen).getTime();
    if (timeDiff > 15000) return false;
    try {
      process.kill(w.pid, 0);
      return true;
    } catch (err) {
      return false;
    }
  });

  if (activeWorkers.length === 0) {
    console.log("No active workers.");
  } else {
    const formattedWorkers = activeWorkers.map((w) => ({
      ID: w.id,
      PID: w.pid,
      Status: w.status,
      "Last Seen": w.last_seen,
      "Started At": w.started_at,
    }));
    console.table(formattedWorkers);
  }
}

module.exports = status;
