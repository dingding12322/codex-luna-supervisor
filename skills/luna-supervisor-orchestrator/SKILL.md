---
name: luna-supervisor-orchestrator
description: Orchestrate bounded GPT-5.6 Luna work as a Supervisor-owned multi-worker DAG with explicit roles, phase barriers, frozen interfaces, scoped writers, read-only scouts, bounded notifications, review, correction, and same-session resume. Use when a task needs Luna for implementation, refactoring, review, research, documentation, diagnostics, or other delegated work.
---

# Luna Supervisor Orchestrator

Keep the current Codex task as the sole Supervisor. The Supervisor owns the result, acceptance decision, DAG, worker boundaries, phase barriers, cross-worker communication, verification, and final handoff. Workers provide scoped execution or read-only evidence; they do not redefine the task.

## Check Runtime Capabilities

Before choosing an execution surface, inspect the tools and model combinations actually available in the current Codex environment.

- Sidebar orchestration requires the Codex thread tools for listing projects, creating tasks, setting titles, sending instructions, reading bounded checkpoints, and waiting for events.
- Never claim that a sidebar Worker was created or notified when the corresponding tool call is unavailable or failed.
- Require `gpt-5.6-luna` to be available for Worker tasks. If it is unavailable, report the capability blocker instead of silently substituting another model.
- The CLI fallback requires Node.js and a working `codex` executable. Use it only under the fallback boundary documented below; if neither execution surface is available, stop before dispatch and report the missing capability.

## Define The Execution Contract

Before launching any worker, write a short execution brief containing:

- Result and observable acceptance criteria.
- Complete known impact map: affected responsibilities, owned paths, shared paths, and dependency edges.
- Roles, phases, dependencies, barrier IDs, and final verification commands.
- Read scopes, write scopes, exclusions, and ownership of shared or cross-cutting files.
- Frozen interfaces and decisions that workers may rely on.
- Topology choice: single writer, non-overlapping multi-writer, or isolated-worktree multi-writer.
- Notification policy and the points at which the Supervisor will read worker tasks.

In multi-worker mode, the Supervisor owns the main task.md or task ledger. Workers may read it when authorized, but never edit it. Prefer an existing project task.md when it is already the repository's resume anchor; otherwise keep the ledger in the Supervisor task. If the Supervisor creates a task.md only as a temporary orchestration ledger, mark it ephemeral at creation and delete it after final acceptance, then remove any guide references added solely for that file. Never delete a pre-existing project task.md as cleanup. Preserve user changes, follow every applicable AGENTS.md, and keep optional cleanup outside the assignment.

## Map Impact And Decide The DAG

Topology and parallelism are Supervisor decisions. Before launching any Worker, the Supervisor reads the foundational documents and the critical code needed to identify the complete known impact surface, then decomposes the result by implementation responsibility rather than by feature name alone. Worker plans may validate local implementation details, but they do not replace Supervisor-owned impact analysis, decomposition, or topology selection.

For every affected responsibility, record:

- Its result, exclusive write scope, exclusions, and owner.
- Shared, registry, generated, entry, documentation-index, or other cross-cutting paths that must move to a sequential Integration Writer.
- Every dependency edge, classified as `contract`, `write_overlap`, or `true_sequence`.
- The frozen interface it consumes or produces.
- Its phase, barrier, and whether it is ready for the current dispatch batch.

A contract dependency does not require sequential implementation. UI use of Runtime types, snapshots, events, or commands is a contract dependency unless both writers must edit the same files. If the Supervisor cannot freeze that interface from current evidence, create all affected plan-only Workers together in P0, close their shared plan barrier, reconcile and freeze the interface once, and then approve all ready non-overlapping P1 writers together.

Before the first create or send call for a phase, write `dispatch_batch`, `expected_events`, `pending_barrier`, and `terminal_workers` to the ledger. The dispatch batch contains every currently ready node in that barrier. Launch or instruct every node in the batch before waiting. A single successful Worker launch is not a completed dispatch while another node in the same barrier remains ready. If part of a batch fails to launch, stay in PLANNING, record and resolve the partial dispatch, and do not wait on the launched subset as though the barrier were fully active.

When choosing a single writer, record `single_writer_reason`. Valid reasons are unavoidable write overlap, an interface that cannot be separated or frozen without performing the implementation, or work so small that coordination would cost at least as much as the change. `same feature`, `shared checkout`, and contract-only dependencies are not sufficient reasons.

## Supervisor State Machine

Use these states as a low-freedom state machine. A completed dispatch batch is a hard stop: after every ready node recorded in the current batch has been launched or instructed successfully, transition immediately to WAITING_FOR_EVENT. Do not stop after the first successful Worker when the batch contains additional ready nodes.

### PLANNING

- Finish foundational reading, acceptance criteria, frozen contracts, ownership, worker and scout allocation, notification policy, and planned verification before any dispatch.
- Before launch, complete the impact map and DAG, then record dispatch_batch, expected_events, pending_barrier, and terminal_workers in the Supervisor ledger or task.md. Set waiting_since and timeout_at only immediately after the full dispatch batch or correction batch succeeds.
- If preparation is incomplete, do not launch. After the complete batch succeeds, set waiting_since and timeout_at, then enter WAITING_FOR_EVENT immediately.

### WAITING_FOR_EVENT

- Wait for only LUNA_PLAN when approval is required, LUNA_BLOCKED, a LUNA_DONE envelope, LUNA_CORRECTION_DONE, a new user instruction, or a 10-minute no-checkpoint timeout.
- Do not call codex_app\_\_read_thread, list_threads, status, log, terminal, or equivalent Worker-task polling tools for polling.
- Do not read Worker-owned changing files, scoped diffs, reports, terminals, raw events, or status output except under the narrow decision and timeout-audit exceptions below.
- Do not rerun decomposition, reopen frozen decisions, reread foundational docs, speculate about Worker progress, or relay routine progress.
- Do not run formatting, lint, typecheck, build, validation, or forward tests early. Do not launch overlapping workers or subagents or send status requests merely to remain active.
- Sidebar routine progress is user-observable; it does not need Supervisor relays.

For LUNA_PLAN when approval is required, or LUNA_BLOCKED when a decision needs full evidence, authorize exactly one bounded read of only the notifying Worker task for that applicable checkpoint. Do not read other Worker tasks. After a successful approval or resolution instruction, set waiting_since=now and timeout_at=now+10m immediately before returning to WAITING_FOR_EVENT; never reset before a required send succeeds.

On a LUNA_DONE envelope, inspect only its envelope and update barrier state and terminal_workers. If required nodes are not terminal, after that update succeeds set waiting_since=now and timeout_at=now+10m immediately before returning to WAITING_FOR_EVENT without reading that Worker task. Read each participating Worker task only after the barrier closes.

At a 10-minute no-checkpoint timeout, permit exactly one bounded status/task anomaly audit. Do not audit more than once per 10-minute window; otherwise the polling prohibition remains absolute. If the Worker is active with recent progress and no blocker, set timeout_at=now+10m and return to WAITING_FOR_EVENT. If stalled, failed, or missing, intervene using only the audit evidence.

A closed barrier or LUNA_CORRECTION_DONE transitions to REVIEWING_BARRIER or ACCEPTING and never resets a waiting deadline. A new user instruction returns to PLANNING without resetting a worker wait. Routine sidebar progress, speculation, file reads, status requests, and polling never count as checkpoints and never reset the window.

### REVIEWING_BARRIER

Enter only for an approval, blocker, closed barrier, correction completion, or timeout audit. Read only the event envelope first. For LUNA_PLAN or LUNA_BLOCKED, use the single narrow notifying-task read above only when its decision requires full evidence; do not read other Worker tasks. For LUNA_DONE, do not read its Worker task before the barrier closes. At a closed barrier, read each participating Worker task at most once per applicable checkpoint or barrier, not once for the Worker's lifetime. Inspect the scoped diff and evidence, then choose the next state.

- Send a bounded correction only from evidence in the closed barrier, then transition to CORRECTING.
- If acceptance criteria are met and planned verification is ready, transition to ACCEPTING.
- After a PLAN/BLOCKED decision or any non-correction outbound worker instruction, return to WAITING_FOR_EVENT immediately after it is sent. The correction send is handled by CORRECTING and then returns to WAITING_FOR_EVENT.

### CORRECTING

Formulate only the bounded correction, affected paths, contract decision, and required checks. Do not broaden exploration or validate early. Sending the correction transitions immediately to WAITING_FOR_EVENT; process LUNA_CORRECTION_DONE at the next barrier.

### ACCEPTING

Run only the planned verification after the final barrier, inspect the final scoped evidence, and make the acceptance decision. Do not start new worker work from this state.

## Separate Roles

- Supervisor: define the contract, create the DAG, launch workers, approve plans, freeze interfaces, resolve blockers, close barriers, inspect diffs and evidence, request corrections, and accept or reject the result.
- Implementation writer: edit only its assigned write scope and return evidence. It owns no shared file unless explicitly assigned.
- Integration Writer: when applicable, run sequentially after implementation writers and own all shared or cross-cutting files. Resolve interface wiring here.
- Reviewer: a Supervisor-owned read-only worker. When used, start runtime and UI reviewers after any applicable integration phase and after implementation workers are idle. Reviewers are never nested inside implementation workers.
- Read-only scout: a bounded native V2 scout used only for source discovery. It never writes, edits task.md, delegates, launches Fleet, or messages the Supervisor.
- CLI worker: a fallback execution surface for strict isolation, persistent raw events, or CLI session resume. It still cannot create nested subagents.

Workers never communicate directly. Relay only frozen interfaces, decisions, relevant paths, and resolved or pending blockers through the Supervisor.

## Select A Topology

Use the topology with the shortest justified serial critical path. Do not collapse independently writable responsibilities into one Worker merely to minimize Worker count.

### Single writer

Use one sidebar-visible implementation worker for a cohesive change only after the Supervisor records `single_writer_reason`. Approve zero, one, or two non-overlapping read-only scouts inside that worker when broad discovery warrants it. The worker remains the only source writer until the Supervisor reviews the result.

### Multi-writer

Use multiple writers only when their write scopes do not overlap or each writer has an isolated worktree. Runtime and UI writers may run concurrently only after their interface contract is frozen. Shared, generated, registry, or cross-cutting files belong to one sequential Integration Writer.

Do not allow a worker to create another writer, reviewer, or Fleet run. When reviewers are used, start them after any applicable integration phase, not from inside implementation workers.

## Build The DAG

Use explicit phases and dependencies, but include only nodes and phases that reduce uncertainty for the task. Skip Integration Writer when there are no shared or cross-cutting writes, skip independent reviewers when risk does not justify them, and never create a worker merely to fill the template:

1. P0 / B0: Supervisor brief and, when needed, all affected plan-only Workers run concurrently so the Supervisor can reconcile and freeze their shared contract.
2. P1 / B1: Runtime Writer and UI Writer execute concurrently only under a frozen contract; a single-writer task has one writer here.
3. P2 / B2 (when applicable): Integration Writer updates shared and cross-cutting files sequentially.
4. P3 / B3 (when applicable): Supervisor-owned Runtime Reviewer and UI Reviewer inspect the integrated result read-only.
5. P4 / B4 (when required): The original writer receives bounded corrections, then the Supervisor rechecks the correction barrier.
6. P5 / B5: Supervisor runs final verification and makes the acceptance decision.

Do not advance a phase until every required node is terminal and every blocker or contract change has a Supervisor decision. If a contract changes, pause dependent writers, record the change, update the affected phase, and relaunch only after the new contract is frozen.

For each phase, dispatch all ready nodes in one batch before entering WAITING_FOR_EVENT. The batch may use concurrent create/send calls, but it is not complete until every recorded ready node has succeeded or the Supervisor has explicitly resolved a launch failure in PLANNING.

## Budget Concurrency And Scouts

- Run one Supervisor.
- Keep at most two concurrent writers in a shared checkout.
- Keep total active sessions at or below six, reserving one platform slot.
- When used, start reviewers only after implementation workers are idle and any applicable integration is complete.
- Approve at most two internal scouts per worker and at most three internal scouts globally.
- Define every scout before launch with a stable name, non-overlapping read scope, questions, exclusions, and required file:line, symbol, and quote evidence.
- Require fork_turns: "none", the default read-only native profile, one round, no writes, no recursive delegation, no worker creation, no Fleet, and no Supervisor messaging.
- Require the worker to launch all approved scouts in one parallel round and wait for all results before editing.

Use native V2 spawn_agent only for approved read-only exploration or independent read-only review. Do not use it to replace a planned writer.

## Launch Sidebar Workers

Use sidebar-visible Codex tasks by default for non-trivial writes and reviews. For project-scoped work, call codex_app\_\_list_projects first, then create one task per cohesive writer with the local project target:

```ts
const worker = await codex_app__create_thread({
  model: "gpt-5.6-luna",
  thinking: "max",
  prompt:
    "[Luna] <assignment>. Edit only <scope>. Contract: <frozen interfaces>. " +
    "Phase: <phase>; barrier: <barrier>. Internal scouts: <approved names or none>. " +
    "Before your final response, actually call codex_app__send_message_to_thread " +
    "with the delegation source_thread_id and the required checkpoint payload; " +
    "printing the payload in final does not count as delivery. " +
    "Return changed paths, verification evidence, and notification_delivery status.",
  target: {
    type: "project",
    projectId,
    environment: { type: "local" },
  },
});

await codex_app__set_thread_title({
  threadId: worker.threadId,
  title: "[Luna] <assignment>",
});
```

State each worker's assignment, write scope, mode, reasoning effort, phase, barrier, exclusions, frozen contract, verification, internal scouts, and the mandatory reverse-send action in the launch prompt. Say internal scouts: none when none are approved. Never weaken the callback to "if supported"; unavailable or failed delivery must use the explicit failure report and bounded Supervisor fallback.

For complex or high-risk work, launch plan-only. Require the plan to list files, interfaces, dependencies, risks, and checks, then stop before editing. Read and approve it explicitly with codex_app\_\_send_message_to_thread; a plan is not approval.

## Enforce Phase Barriers

Give each phase a stable ID and each barrier a stable barrier_id. Track worker state in the Supervisor task ledger or task.md; never ask workers to maintain the shared ledger.

- LUNA_PLAN is sent only when the Supervisor must approve a plan.
- LUNA_BLOCKED requires an immediate Supervisor decision. Do not silently expand scope.
- LUNA_DONE is recorded when received, but the Supervisor does not deep-read the worker task until that phase barrier closes.
- LUNA_CORRECTION_DONE is processed at the correction barrier.
- Routine progress, reasoning, logs, command output, and minute-by-minute status are never notifications.

After a relevant barrier closes, read each participating worker task at most once for that applicable checkpoint or barrier, inspect its scoped diff and evidence, and decide whether to advance, integrate, review, or correct. A required PLAN or BLOCKED decision may use only the single notifying-task read permitted above before closure. If review finds a blocking issue, send the correction to the same worker thread and keep the same assignment lineage.

## Use Bounded Notifications

Workers must deliver one concise wake-up per applicable checkpoint by actually calling `codex_app__send_message_to_thread` with the delegation context `source_thread_id` as `threadId`. Writing or printing an event envelope only in the Worker final response is not a notification and must not be reported as a successful send. Every payload includes the same fields:

```json
{
  "event": "LUNA_DONE",
  "worker_thread_id": "<worker_thread_id>",
  "assignment_or_status": "<assignment or status>",
  "phase": "<phase-id>",
  "barrier_id": "<barrier-id>",
  "decision_required": false,
  "contract_changes": [],
  "changed_paths": {
    "count": 3,
    "paths": ["<path-1>", "<path-2>", "<path-3>"]
  },
  "validation_summary": "<concise validation result>",
  "request": "Supervisor: read this Worker task once after the barrier closes and review its scoped diff."
}
```

Use an empty changed_paths list for non-completion events. Set decision_required true only when the Supervisor must decide, especially for a blocker or contract change. Keep contract_changes empty when no interface or decision changed; otherwise list exact frozen-contract changes. The request must ask only for scoped Supervisor review and must never ask a worker to broaden its assignment.

Before the Worker final response, send the serialized payload with an explicit tool call:

```ts
await codex_app__send_message_to_thread({
  threadId: sourceThreadId,
  prompt: `[${payload.event}]\n${JSON.stringify(payload)}`,
});
```

The delegation `source_thread_id` is the notification target, not the Worker identity. Never copy it into `worker_thread_id`; use the actual Worker thread ID when known, otherwise use `null` and let the Supervisor rely on sender metadata and its dispatch ledger.

Treat a missing tool call or failed reverse send as a delivery failure. Record `notification_delivery: failed`, the target, event, and exact error in the Worker final report; never emit a bare success envelope that could be mistaken for a delivered wake-up. The Supervisor falls back to one bounded codex_app\_\_read_thread check at the relevant barrier. On success, record `notification_delivery: sent` in the Worker final report.

## Recover And Correct

Treat 429 Too Many Requests and exceeded retry limit, last status: 429 as retryable transport failures. Resume the original thread and session immediately with the exact message 继续. Do not inspect status, poll logs, create a replacement, resend the assignment, or switch surfaces to hide the failure.

For a sidebar worker:

```ts
await codex_app__send_message_to_thread({
  threadId: originalThreadId,
  prompt: "继续",
});
```

For a CLI worker, resume the original run and worker with the original effort:

```bash
node ~/.codex/skills/luna-supervisor-orchestrator/scripts/luna-fleet.mjs resume \
  --run <run-directory> \
  --worker <worker-id> \
  --task 继续 \
  --effort <original-effort>
```

Use the same thread or CLI session for corrections. Send only the bounded issue, affected paths, contract decision, and required checks. Process the result at the correction barrier, then rerun only checks affected by the correction.

## Verify And Accept

At each barrier, inspect authorized paths, out-of-scope changes, worker evidence, and contract adherence. Run the smallest relevant code-level formatting, typecheck, lint, build, parser, or configuration check. Follow repository rules for tests and runtime verification; do not create tests when prohibited, and do not use browsers, simulators, devices, screenshots, or runtime UI interaction when those checks are forbidden.

The Supervisor, not a worker, makes the final acceptance decision. Report changed paths, verification evidence, unresolved non-blocking observations, and whether runtime visual verification was intentionally not performed.

## CLI Fallback

Use scripts/luna-fleet.mjs only when strict process isolation, persistent raw events, or CLI session resume is required. Keep the historical artifact root at ~/.codex/luna-fleet-runs/. The script filename and command surface remain compatible:

```bash
node ~/.codex/skills/luna-supervisor-orchestrator/scripts/luna-fleet.mjs start \
  --cwd "$PWD" \
  --task "Perform the bounded assignment." \
  --scopes "src/module" \
  --mode workspace-write \
  --effort max

node ~/.codex/skills/luna-supervisor-orchestrator/scripts/luna-fleet.mjs status --run <run-directory>
```

CLI Fleet is never the normal implementation path, and its workers must continue prohibiting nested subagents. Never commit or push unless the user explicitly requests that exact action.
