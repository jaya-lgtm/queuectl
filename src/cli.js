#!/usr/bin/env node
const { Command } = require("commander");
const initializeDatabase = require("./database/schema");
const enqueue = require("./commands/enqueue");
const list = require("./commands/list");
const status = require("./commands/status");
const { startWorkers, stopWorkers } = require("./commands/worker");
const { dlqList, dlqRetry } = require("./commands/dlq");
const { configGet, configSet } = require("./commands/config");

initializeDatabase();

const program = new Command();
program
  .name("queuectl")
  .description("QueueCTL - Simple Persistent Job Queue")
  .version("1.0.0");

program
  .command("enqueue <jobJson...>")
  .description("Add a job to the queue")
  .action((jobJsonParts) => {
    enqueue(jobJsonParts.join(" "));
  });

const workerCmd = program.command("worker").description("Manage workers");

workerCmd
  .command("start")
  .description("Start workers in the foreground")
  .option("--count <count>", "Number of workers to start", "1")
  .action((options) => {
    startWorkers(options);
  });

workerCmd
  .command("stop")
  .description("Gracefully stop all running workers")
  .action(() => {
    stopWorkers();
  });

program
  .command("status")
  .description("Show summary of all job states & active workers")
  .action(() => {
    status();
  });

program
  .command("list")
  .description("List jobs by state")
  .option("--state <state>", "Filter jobs by state (pending, processing, completed, failed, dead)")
  .option("--json", "Output only JSON array of jobs")
  .action((options) => {
    list(options);
  });

const dlqCmd = program.command("dlq").description("Manage Dead Letter Queue (DLQ)");

dlqCmd
  .command("list")
  .description("List all jobs in the Dead Letter Queue")
  .action(() => {
    dlqList();
  });

dlqCmd
  .command("retry <id>")
  .description("Re-enqueue a dead job from DLQ")
  .action((id) => {
    dlqRetry(id);
  });

const configCmd = program.command("config").description("Manage configuration settings");

configCmd
  .command("get")
  .description("Get all configuration values")
  .action(() => {
    configGet();
  });

configCmd
  .command("set <key> <value>")
  .description("Set configuration value")
  .action((key, value) => {
    configSet(key, value);
  });

program.parse(process.argv);
