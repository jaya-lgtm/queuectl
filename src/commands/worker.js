const childProcess = require("child_process");
const path = require("path");
const { setConfig } = require("../repositories/configRepository");
const { getActiveWorkers, updateWorkerStatus } = require("../repositories/workerRepository");

function startWorkers(options = {}) {
  const count = parseInt(options.count || "1", 10);
  console.log(`Starting ${count} worker(s) in the foreground...`);

  setConfig("shutdown_requested", "false");

  const children = [];
  let exitedCount = 0;
  let isShuttingDown = false;

  function shutdownChildren() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nShutdown signal received. Stopping all workers gracefully...");

    setConfig("shutdown_requested", "true");

    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch (err) {}
    }
  }

  process.on("SIGINT", shutdownChildren);
  process.on("SIGTERM", shutdownChildren);

  const workerScript = path.join(__dirname, "../services/workerProcess.js");

  for (let i = 0; i < count; i++) {
    const workerId = `worker-${process.pid}-${i + 1}-${Date.now()}`;
    const child = childProcess.fork(workerScript, [workerId]);
    children.push(child);

    child.on("exit", (code) => {
      exitedCount++;
      console.log(`Worker process ${workerId} exited with code ${code}. (${exitedCount}/${count} stopped)`);
      if (exitedCount === count) {
        console.log("All workers have stopped. Exiting.");
        process.exit(0);
      }
    });
  }
}

function stopWorkers() {
  console.log("Requesting all active workers to stop gracefully...");

  setConfig("shutdown_requested", "true");

  const workers = getActiveWorkers();
  if (workers.length === 0) {
    console.log("No registered workers found.");
    return;
  }

  for (const worker of workers) {
    try {
      updateWorkerStatus(worker.id, "stopping");
      console.log(`Signaling worker ${worker.id} (PID ${worker.pid}) to stop`);
      process.kill(worker.pid, "SIGINT");
    } catch (err) {}
  }

  console.log("Graceful stop signal sent to all workers.");
}

module.exports = {
  startWorkers,
  stopWorkers,
};
