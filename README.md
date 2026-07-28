# QueueCTL – Persistent CLI Background Job Queue

QueueCTL is a production-grade, command-line background job queue built with **Node.js**, **Commander.js**, **SQLite (better-sqlite3)**, and a layered architecture. It provides persistent job storage, concurrent worker execution, automatic retries with exponential backoff, Dead Letter Queue (DLQ) support, crash recovery, graceful shutdown, and configurable runtime settings.

The project is designed to demonstrate backend engineering concepts such as concurrent job processing, atomic database transactions, process management, fault tolerance, and persistent task scheduling.

---

# Features

- Persistent SQLite-based job queue
- Concurrent worker processes
- Atomic job claiming (exactly-once execution)
- Exponential backoff retry mechanism
- Dead Letter Queue (DLQ)
- Automatic crash recovery
- Graceful shutdown
- Persistent configuration
- JSON output support
- Production-style layered architecture

---

# Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js |
| CLI | Commander.js |
| Database | SQLite |
| SQLite Library | better-sqlite3 |
| Process Execution | child_process |
| Architecture | Repository-Service Pattern |

---

# Project Structure

```text
src/
│
├── cli.js
│
├── commands/
│   ├── enqueue.js
│   ├── list.js
│   ├── status.js
│   ├── worker.js
│   ├── dlq.js
│   └── config.js
│
├── services/
│   ├── jobServices.js
│   └── workerProcess.js
│
├── repositories/
│   ├── jobRepository.js
│   ├── workerRepository.js
│   └── configRepository.js
│
├── database/
│   ├── database.js
│   └── schema.js
│
└── utils/
```

---

# Architecture

QueueCTL follows a layered architecture.

```
                User

                  │

                  ▼

          Commander CLI

                  │

                  ▼

         Command Handlers

                  │

                  ▼

        Business Services

                  │

                  ▼

      Repository Layer

                  │

                  ▼

        SQLite Database
```

## Layer Responsibilities

### CLI

Registers all CLI commands using Commander.js.

### Commands

Parse command-line arguments and invoke the appropriate service.

### Services

Contain all business logic including:

- Worker management
- Retry logic
- DLQ management
- Status reporting
- Crash recovery

### Repositories

Responsible only for SQLite operations.

No business logic exists in this layer.

### Database

Stores:

- Jobs
- Workers
- Configuration

---

# Installation

Clone the repository.

Install dependencies.

```bash
npm install
```

Run commands locally.

```bash
node src/cli.js
```

---

# CLI Commands

## Enqueue a Job

```bash
node src/cli.js enqueue '{"id":"job1","command":"sleep 2"}'
```

Example

```bash
node src/cli.js enqueue '{"id":"job2","command":"echo Hello"}'
```

---

## Start Workers

Start three workers.

```bash
node src/cli.js worker start --count 3
```

Workers run in the foreground until stopped.

---

## Stop Workers

Gracefully stop all workers.

```bash
node src/cli.js worker stop
```

Workers finish their current job before exiting.

---

## Status

Display summary.

```bash
node src/cli.js status
```

Example output

```
Pending : 4

Processing : 2

Completed : 16

Failed : 1

Dead : 0

Workers : 3
```

---

## List Jobs

List pending jobs.

```bash
node src/cli.js list --state pending
```

Completed jobs.

```bash
node src/cli.js list --state completed
```

JSON output.

```bash
node src/cli.js list --state pending --json
```

When `--json` is supplied, stdout contains only valid JSON.

---

## Dead Letter Queue

List dead jobs.

```bash
node src/cli.js dlq list
```

Retry a dead job.

```bash
node src/cli.js dlq retry job1
```

The job:

- resets attempts
- clears last_error
- moves back to pending

---

## Configuration

View configuration.

```bash
node src/cli.js config get
```

Update maximum retries.

```bash
node src/cli.js config set max-retries 5
```

Update exponential backoff base.

```bash
node src/cli.js config set backoff-base 2
```

---

# Database Schema

SQLite runs in **Write-Ahead Logging (WAL)** mode with a **5-second busy timeout** to support concurrent workers while minimizing database locking.

---

## Jobs Table

| Column | Description |
|---------|-------------|
| id | Unique job identifier |
| command | Shell command to execute |
| state | pending, processing, completed, failed, dead |
| attempts | Number of execution attempts |
| max_retries | Maximum retries |
| worker_id | Worker processing the job |
| next_retry_at | Next retry timestamp |
| last_heartbeat | Latest worker heartbeat |
| last_error | Error from previous execution |
| created_at | Creation timestamp |
| updated_at | Last update timestamp |

---

## Workers Table

| Column | Description |
|---------|-------------|
| id | Worker ID |
| pid | Process ID |
| status | active or stopping |
| last_seen | Latest heartbeat |
| started_at | Worker startup time |

---

## Config Table

| Key | Description |
|-----|-------------|
| max_retries | Default retry count |
| backoff_base | Retry multiplier |
| shutdown_requested | Global shutdown flag |

---

# Job Lifecycle

```
Pending

   │

   ▼

Processing

   │

   ├──────────────┐
   │              │

Success       Failure

   │              │

   ▼              ▼

Completed     Retry Scheduled

                  │

                  ▼

             Processing

                  │

                  ▼

        Maximum Retries Reached

                  │

                  ▼

          Dead Letter Queue
```

---

# Worker Lifecycle

```
Worker Starts

      │

      ▼

Register Worker

      │

      ▼

Heartbeat

      │

      ▼

Claim Pending Job

      │

      ▼

Execute Command

      │

      ▼

Update Job State

      │

      ▼

Repeat
```

Workers continue until a shutdown request is received.

---

# Atomic Job Claiming

QueueCTL guarantees that every job is executed **exactly once**, even when multiple workers are running simultaneously.

Workers claim jobs using a single atomic SQLite transaction.

Only one worker can transition a job from:

```
pending

↓

processing
```

If two workers attempt to claim the same job simultaneously, SQLite allows only one transaction to succeed.

This prevents duplicate execution across multiple operating system processes.

---

# Exponential Backoff

When a command fails, QueueCTL schedules a retry using:

```
delay = backoff_base ^ attempts
```

Default configuration

```
backoff_base = 2
```

Example

| Attempt | Delay |
|----------|-------|
| 1 | 2 seconds |
| 2 | 4 seconds |
| 3 | 8 seconds |

If the retry limit is exceeded, the job is moved to the Dead Letter Queue.

---

# Dead Letter Queue (DLQ)

Jobs exceeding the configured retry limit enter the DLQ.

Commands

```bash
node src/cli.js dlq list
```

```bash
node src/cli.js dlq retry job1
```

Retrying a job:

- resets attempts
- clears previous error
- updates timestamps
- changes state to pending

---

# Crash Recovery

Each worker sends a heartbeat every **5 seconds**.

If a worker crashes unexpectedly:

- processing jobs remain stored in SQLite
- other workers detect stale heartbeats
- stale jobs are recovered
- recovered jobs are rescheduled

A worker is considered dead after approximately **15 seconds** without a heartbeat.

Recovery occurs automatically without user intervention.

---

# Graceful Shutdown

Workers respond to:

- SIGINT
- SIGTERM

Shutdown procedure:

1. Finish current job.
2. Update database.
3. Remove worker registration.
4. Exit cleanly.

---

# Worker Stop

Running

```bash
node src/cli.js worker stop
```

will:

1. Update worker status in SQLite.
2. Attempt to signal worker processes.
3. Workers detect shutdown during heartbeat polling.
4. Workers finish their active job.
5. Workers exit gracefully.

This design works across both Windows and Linux.

---

# Configuration Behavior

Configuration values are stored permanently in SQLite.

Changing configuration affects:

### Newly Enqueued Jobs

Use the latest configuration values.

### Existing Jobs

Retain the `max_retries` value assigned when they were created, ensuring predictable behavior throughout their lifecycle.

---

# Logging

Normal CLI commands display human-readable logs.

Example

```
Worker Started

Job Claimed

Job Completed

Retry Scheduled

Moved to DLQ

Worker Shutdown
```

When `--json` is specified, QueueCTL outputs **only JSON** to stdout, making it suitable for scripting and automation.

---

# Testing

## Enqueue Jobs

```bash
node src/cli.js enqueue '{"id":"job1","command":"echo Hello"}'
```

## Start Workers

```bash
node src/cli.js worker start --count 3
```

## Status

```bash
node src/cli.js status
```

## List Pending Jobs

```bash
node src/cli.js list --state pending
```

## JSON Output

```bash
node src/cli.js list --state pending --json
```

## Dead Letter Queue

```bash
node src/cli.js dlq list
```

## Retry DLQ Job

```bash
node src/cli.js dlq retry job1
```

## Stop Workers

```bash
node src/cli.js worker stop
```

---

# Design Decisions

Detailed implementation decisions are documented in **DECISIONS.md**, including:

- Atomic job claiming
- Crash recovery strategy
- Retry policy
- Worker stop mechanism
- Future extensibility (priority queues)

---

# Future Improvements

Potential enhancements include:

- Priority queues
- Scheduled jobs
- Job cancellation
- Worker auto-scaling
- Web dashboard
- Job history and metrics
- REST API
- Authentication and authorization

---

#video presentation:- https://drive.google.com/file/d/16xz5fTjFIaWiC0MaeCOsd15PBPo5nCTk/view?usp=sharing

# License

This project was developed as part of the **QueueCTL Backend Internship Assignment** and is intended for educational and evaluation purposes.
