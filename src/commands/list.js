const { getAllJobs } = require("../services/jobServices");

function list(options = {}) {
  const state = options.state;
  const isJson = options.json;

  let jobs = getAllJobs();
  if (state) {
    jobs = jobs.filter((j) => j.state === state);
  }

  if (isJson) {
    console.log(JSON.stringify(jobs));
    return;
  }

  if (jobs.length === 0) {
    console.log("No jobs found.");
    return;
  }

  const formattedJobs = jobs.map((job) => {
    let commandStr = job.command;
    if (commandStr && commandStr.length > 30) {
      commandStr = commandStr.substring(0, 27) + "...";
    }
    return {
      ID: job.id,
      Command: commandStr,
      State: job.state,
      Attempts: job.attempts,
      "Max Retries": job.max_retries,
      "Next Retry": job.next_retry_at || "N/A",
    };
  });
  console.table(formattedJobs);
}

module.exports = list;
