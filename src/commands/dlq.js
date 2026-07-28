const { getAllJobs } = require("../services/jobServices");
const { retryJobFromDLQ } = require("../repositories/jobRepository");

function dlqList() {
  const jobs = getAllJobs().filter((job) => job.state === "dead");
  if (jobs.length === 0) {
    console.log("Dead Letter Queue (DLQ) is empty.");
    return;
  }

  const formattedJobs = jobs.map((job) => {
    let errorStr = "N/A";
    if (job.last_error) {
      errorStr = job.last_error.replace(/[\r\n]+/g, " ");
      if (errorStr.length > 50) {
        errorStr = errorStr.substring(0, 47) + "...";
      }
    }
    return {
      ID: job.id,
      Command: job.command,
      Attempts: job.attempts,
      "Max Retries": job.max_retries,
      "Last Error": errorStr,
      "Failed At": job.updated_at,
    };
  });
  console.table(formattedJobs);
}

function dlqRetry(id) {
  const success = retryJobFromDLQ(id);
  if (success) {
    console.log(`Successfully re-enqueued job "${id}" from DLQ to pending.`);
  } else {
    console.error(`Error: Job "${id}" not found in DLQ (state must be "dead").`);
    process.exit(1);
  }
}

module.exports = {
  dlqList,
  dlqRetry,
};
