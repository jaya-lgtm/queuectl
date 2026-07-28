const { setConfig, getAllConfig } = require("../repositories/configRepository");

function configGet() {
  const configs = getAllConfig();
  console.log("=== QueueCTL Configuration ===");
  for (const row of configs) {
    console.log(`${row.key}: ${row.value}`);
  }
}

function configSet(key, value) {
  const normalizedKey = key.replace(/-/g, "_");

  if (normalizedKey !== "max_retries" && normalizedKey !== "backoff_base" && normalizedKey !== "shutdown_requested") {
    console.error(`Error: Unknown configuration key "${key}". Valid keys are: max-retries, backoff-base`);
    process.exit(1);
  }

  if (normalizedKey === "max_retries") {
    const val = parseInt(value, 10);
    if (isNaN(val) || val < 0) {
      console.error("Error: max-retries must be a non-negative integer.");
      process.exit(1);
    }
  } else if (normalizedKey === "backoff_base") {
    const val = parseFloat(value);
    if (isNaN(val) || val <= 0) {
      console.error("Error: backoff-base must be a positive number.");
      process.exit(1);
    }
  }

  setConfig(normalizedKey, value);
  console.log(`Successfully updated configuration: ${key} = ${value}`);
}

module.exports = {
  configGet,
  configSet,
};
