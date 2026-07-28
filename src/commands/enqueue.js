const { enqueueJob } = require("../services/jobServices");

function parseRelaxedJson(str) {
  str = str.trim();
  if (!str.startsWith("{") || !str.endsWith("}")) {
    throw new Error("Invalid format: Must start with '{' and end with '}'");
  }
  const content = str.slice(1, -1).trim();
  const keyRegex = /["']?(\w+)["']?\s*:/g;
  const keys = [];
  let match;
  while ((match = keyRegex.exec(content)) !== null) {
    keys.push({
      key: match[1],
      index: match.index,
      length: match[0].length
    });
  }

  if (keys.length === 0) {
    throw new Error("No valid JSON keys found");
  }

  const job = {};
  for (let i = 0; i < keys.length; i++) {
    const current = keys[i];
    const next = keys[i + 1];
    const valueStart = current.index + current.length;
    const valueEnd = next ? next.index : content.length;
    
    let rawValue = content.slice(valueStart, valueEnd).trim();
    if (rawValue.endsWith(",")) {
      rawValue = rawValue.slice(0, -1).trim();
    }
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || 
        (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      rawValue = rawValue.slice(1, -1);
    }
    
    if (current.key === "max_retries" || current.key === "attempts") {
      const num = parseInt(rawValue, 10);
      job[current.key] = isNaN(num) ? rawValue : num;
    } else {
      job[current.key] = rawValue;
    }
  }

  return job;
}

function enqueue(jobJson) {
  try {
    let job;
    try {
      job = JSON.parse(jobJson);
    } catch (parseError) {
      // Try parsing with relaxed JSON parser (e.g. for PowerShell quote-stripped strings)
      job = parseRelaxedJson(jobJson);
    }
    enqueueJob(job);
    console.log(`Successfully enqueued job "${job.id}"`);
  } catch (error) {
    console.error("Error enqueuing job:", error.message);
    process.exit(1);
  }
}

module.exports = enqueue;

