const { enqueueJob } = require("../services/jobServices");

function enqueue(jobJson) {
  try {
    const job = JSON.parse(jobJson);
    enqueueJob(job);
    console.log(`Successfully enqueued job "${job.id}"`);
  } catch (error) {
    console.error("Error enqueuing job:", error.message);
    process.exit(1);
  }
}

module.exports = enqueue;
