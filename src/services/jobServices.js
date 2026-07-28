const {
  createJob,
  listJobs,
  findJobById,
} = require("../repositories/jobRepository");
const { getConfig } = require("../repositories/configRepository");

function enqueueJob(job) {
  if (!job.id || !job.command) {
    throw new Error("Job must contain id and command.");
  }

  const existingJob = findJobById(job.id);
  if (existingJob) {
    throw new Error(`Job with ID "${job.id}" already exists.`);
  }

  const now = new Date().toISOString();

  const defaultMaxRetries = parseInt(getConfig("max_retries") || "3", 10);
  const maxRetries = job.max_retries !== undefined ? parseInt(job.max_retries, 10) : defaultMaxRetries;

  const newJob = {
    id: job.id,
    command: job.command,
    state: "pending",
    attempts: 0,
    max_retries: maxRetries,
    created_at: now,
    updated_at: now,
    next_retry_at: null,
    worker_id: null,
    last_error: null,
  };

  createJob(newJob);

  return newJob;
}

function getAllJobs() {
  return listJobs();
}

function getJobStatus(id) {
  return findJobById(id);
}

module.exports = { enqueueJob, getAllJobs, getJobStatus };
