# DECISIONS.md

# QueueCTL – Architecture & Design Decisions

This document explains the major architectural decisions made while implementing QueueCTL. Each section answers one of the required design questions from the assignment.

---

# 1. Which exact line(s) prevent two workers from claiming the same job, and why is that operation atomic across separate OS processes?

The job is claimed inside a single SQLite transaction using the following code:

```javascript
const claimJobAtomic = db.transaction((workerId, now) => {
    const job = db.prepare(`
        SELECT *
        FROM jobs
        WHERE
            state = 'pending'
            OR (
                state = 'failed'
                AND next_retry_at <= ?
            )
        ORDER BY created_at ASC
        LIMIT 1
    `).get(now);

    if (!job) return null;

    const result = db.prepare(`
        UPDATE jobs
        SET
            state = 'processing',
            worker_id = ?,
            updated_at = ?,
            last_heartbeat = ?
        WHERE
            id = ?
            AND (
                state = 'pending'
                OR (
                    state = 'failed'
                    AND next_retry_at <= ?
                )
            )
    `).run(workerId, now, now, job.id, now);

    if (result.changes === 1) {
        return job;
    }

    return null;
});
```

### Which lines prevent duplicate execution?

The critical lines are:

```sql
UPDATE jobs
SET state='processing',
    worker_id=?,
    updated_at=?,
    last_heartbeat=?
WHERE id=?
AND (
    state='pending'
    OR (
        state='failed'
        AND next_retry_at<=?
    )
)
```

and

```javascript
if (result.changes === 1)
```

### Why is this atomic?

The claim operation executes inside one SQLite transaction.

SQLite allows only one transaction to successfully update the same row at a time.

If two workers read the same pending job simultaneously:

- Worker A updates the row first.
- The job state immediately changes from `pending` to `processing`.
- Worker B's UPDATE no longer matches the WHERE clause.
- `result.changes` becomes `0`.
- Worker B returns `null` and searches for another job.

Therefore only one worker can successfully claim a job, even when multiple worker processes are running.

---

# 2. A worker is SIGKILLed halfway through a job. Walk through, step by step, what state the job is in and how it eventually runs again. What is the worst-case delay before recovery?

When a worker receives SIGKILL, the operating system immediately terminates the process.

The worker cannot execute cleanup handlers.

The recovery process is:

### Step 1

The worker has already claimed the job.

Job state:

```
processing
```

Worker record:

```
active
```

---

### Step 2

The process is killed.

The job remains

```
processing
```

because the worker never had a chance to update it.

---

### Step 3

Other workers continue running normally.

Every worker updates:

```
workers.last_seen
```

every **5 seconds**.

---

### Step 4

Each worker periodically checks for stale workers.

A worker is considered dead if:

- heartbeat is older than **15 seconds**, or
- `process.kill(pid, 0)` reports that the process no longer exists.

---

### Step 5

The recovery worker reclaims every job owned by the dead worker.

If:

```
attempts < max_retries
```

the job becomes

```
failed
```

and receives a new

```
next_retry_at
```

using exponential backoff.

Otherwise it becomes

```
dead
```

and enters the Dead Letter Queue.

---

### Step 6

When

```
next_retry_at <= current time
```

another worker claims the job and executes it normally.

### Worst-case recovery time

Heartbeat interval:

```
5 seconds
```

Heartbeat timeout:

```
15 seconds
```

Recovery scan:

```
every 5 seconds
```

Worst-case recovery occurs in approximately **20 seconds**, which is well below the assignment requirement of **60 seconds**.

---

# 3. Does dlq retry reset attempts? Why is that the right call?

Yes.

Running

```bash
queuectl dlq retry <job-id>
```

performs:

```
attempts = 0

last_error = NULL

state = pending

updated_at = current time
```

### Why?

A job enters the Dead Letter Queue only after exhausting all retry attempts.

A manual retry indicates that a human has fixed the underlying problem.

Examples include:

- restarting a database
- fixing configuration
- restoring a dependency
- correcting the command

If attempts were not reset, the job would immediately return to the DLQ after the next failure because it would already be at its retry limit.

Resetting attempts gives the job a fresh retry budget under the corrected environment.

---

# 4. What designs did you consider and reject for worker stop (cross-process signaling), and why?

The goal is to allow

```bash
queuectl worker stop
```

to stop workers running in different terminal windows.

## Option 1 – Only use process.kill()

Rejected.

Reasons:

- unreliable on Windows
- different behavior across operating systems
- cannot always guarantee graceful shutdown

---

## Option 2 – TCP or Unix sockets

Rejected.

Reasons:

- requires additional infrastructure
- socket cleanup
- port conflicts
- unnecessary complexity for this assignment

---

## Adopted Design

QueueCTL uses SQLite as the coordination mechanism.

When

```bash
queuectl worker stop
```

is executed:

1. Worker status is updated to

```
stopping
```

2. Configuration flag

```
shutdown_requested
```

is enabled.

3. Platform-specific signaling:
   - **Linux/Unix**: A best-effort `process.kill(pid, "SIGINT")` is attempted to trigger the process's handler.
   - **Windows**: `process.kill(pid, "SIGINT")` is skipped. Node's signal emulation on Windows terminates processes immediately, which would force-kill in-flight jobs. Instead, workers on Windows rely on database status polling to exit gracefully.

4. Workers poll the database every heartbeat and every polling iteration.

5. If shutdown is requested, the worker:

- finishes the current job
- updates the database
- removes its worker record
- exits cleanly

This approach works consistently across Windows and Linux while supporting graceful shutdown.

---

# 5. If priorities were added tomorrow (high-priority jobs jump the queue), which parts of your design survive unchanged and which break?

Most of the architecture remains unchanged.

## Unchanged

- CLI architecture
- Repository pattern
- Service layer
- Worker loop
- Heartbeat system
- Crash recovery
- Retry logic
- Graceful shutdown
- Configuration system
- Dead Letter Queue

---

## Required Changes

### Database

Add one column:

```sql
priority INTEGER DEFAULT 0
```

---

### Repository

Only the ordering of the claim query changes.

Current:

```sql
ORDER BY created_at ASC
```

Updated:

```sql
ORDER BY priority DESC, created_at ASC
```

---

### Enqueue

Allow:

```json
{
    "id": "job1",
    "command": "echo Hello",
    "priority": 10
}
```

If omitted:

```
priority = 0
```

---

### Worker Logic

No changes are required.

Workers continue claiming jobs exactly as before.

The SQL query simply returns higher-priority jobs first.

---

# Conclusion

QueueCTL is designed around reliability, concurrency, and maintainability.

The combination of SQLite transactions, atomic job claiming, worker heartbeats, automatic crash recovery, graceful shutdown, and a layered architecture ensures that jobs are executed safely even when multiple worker processes run concurrently or unexpected process failures occur.