# Per-chat project assistants and background workers

Date: 2026-10-01
Status: Source implementation and live worker flow verified; installed-app activation and same-Wi-Fi device verification remain release gates
Scope: Aladdin on an awake Mac, using the existing local harness

## Decision in one minute

Each root chat is a separate Michael assistant for its selected project/company. It owns a durable task ledger and can run up to **three background workers per chat**. Michael dispatches work, ends his turn, and remains available for conversation. Workers have separate sessions. Additional tasks wait in that chat's ledger.

Three chats can therefore run nine workers, in addition to their conversational assistants. The three-worker limit is not global and is not a per-prompt launch allowance. Opening a second window on the same chat does not create another team.

Workers raise questions and permissions through the existing native popup. The runtime presents the original request in the owning chat and delivers the user's response to the exact worker. Michael may explain a request but is not required to run a model call to deliver it.

Use the existing Effect, SQLite, Session, EventV2, and local execution infrastructure. Add explicit task ownership, dispatch, and recovery. Do not introduce remote servers, a global CEO agent, a framework migration, or a constant LLM polling loop.

This document supersedes the earlier suggestion of three workers shared globally.

## 1. Product requirements

- Assistant ownership: one assistant per root chat, represented by its stable Session ID.
- Project ownership: each chat binds to a canonical project directory and its existing Location. Workers inherit that placement and task scope.
- Concurrency: each chat has three worker slots. Other chats have their own three slots.
- Conversation: dispatch does not wait for task completion. Discussion and additional dispatches remain available while workers execute.
- Durable queue: accepted tasks survive UI reloads, application restarts, and context compaction.
- Human input: preserve the native question and permission interfaces, including click choices and typed responses.
- Delivery: questions, progress, and results belong to the originating chat, not whichever chat is currently selected.
- Control: stop reply, cancel task, pause dispatch, and cancel all tasks are separate operations.
- Local execution: execution runs on the Mac. No remote worker service or server deployment is included.
- Long-running work: tasks may span many model turns while the Mac is awake and the execution host is running. Time, token, and cost policies still apply.
- Verification: a worker saying "done" is insufficient. Required checks and artifact handling must succeed before completion.

Closing a tab or switching projects does not cancel its tasks. Quitting the application stops local execution in the first release, preserves the ledger, and invokes the recovery rules in section 10. Persisted state does not mean execution continues while the application is closed or the Mac is asleep.

### Example

```text
Chat A / Company A / folder A
  Michael A + Ledger A + Worker A1 + Worker A2 + Worker A3
  Tasks A4, A5, ... wait in Ledger A

Chat B / Company B / folder B
  Michael B + Ledger B + Worker B1 + Worker B2 + Worker B3
  Tasks B4, B5, ... wait in Ledger B

Chat C / Company C / folder C
  Michael C + Ledger C + Worker C1 + Worker C2 + Worker C3
  Tasks C4, C5, ... wait in Ledger C
```

## 2. Research findings and their consequences

The recommendation draws on first-party engineering accounts and documentation, reproducible issue reports, a practitioner article, and archived Reddit discussions. These sources do not establish that one framework is universally best. They establish specific failure modes that the design must address.

- Anthropic [R1] describes bounded briefs, independent contexts, artifacts, and checkpoints. Synchronous supervisors block, extra agents increase cost, and tightly coupled coding offers less parallelism. We should separate assistant/worker sessions, delegate selectively, and return evidence-backed handoffs.
- Temporal [R2] demonstrates durable human waits, separate execution queues, and side-effect risks during retries. We should persist interactions, reserve conversational capacity, and classify recovery by side-effect safety without deploying Temporal.
- LangGraph [R3] documents that resuming a node re-executes its earlier code. We must define checkpoint and answer-delivery semantics; a saved question does not make a tool safe to replay.
- Google ADK [R4] commits state before forwarding events and continuing execution. We should persist accepted work and transitions before acknowledgement or notification.
- SQLite [R5] supports one concurrent writer. An immediate write transaction can serialize a claim and its capacity check. Keep claims short and never await a model, tool, or user inside the transaction.
- LangGraph issue #6533 [R6] records misrouted parallel approvals caused by colliding request identities. It is closed. Its failure case informs simultaneous-question, stale-answer, and duplicate-delivery tests.
- Codex issue #31178 [R7] reports parent-thread blocking and lost late results despite parallel children. Dispatch must finish the parent's turn; result delivery must survive parent interruption.
- CrewKit [R8] reports failures with prompt-only handoffs, shared long histories, and boolean approval flags. Use structured task records and first-class interactions; do not adopt its additional business-learning machinery.
- Reddit snapshots [R9-R11] report context inflation, lost constraints, and shared-state races. Short contracts plus artifact references recur as advice. Validate typed handoffs and keep raw worker transcripts out of routine assistant context. These reports are anecdotes, not benchmarks.

No performance, reliability, or cost improvement is claimed as measured for Aladdin. The acceptance gates below specify how to establish those properties.

## 3. Existing components and actual gaps

This inventory is based on repository source inspected for this document, not on an assumption that every experimental feature is enabled in the installed app.

- `packages/core/src/session/run-coordinator.ts`: serializes each Session while different Sessions execute concurrently. It does not implement durable task ownership or per-chat quotas.
- `packages/core/src/session/execution/local.ts`: routes process-global Session IDs to Location-scoped runners. Add task-ledger claims and recovery above this layer.
- `packages/core/src/session/input.ts` and `specs/v2/session.md`: provide durable input admission, exact-retry reconciliation, and steer/queue delivery. A prompt inbox is not a job ledger, and these delivery modes do not create an independent conversation.
- `packages/core/src/background-job.ts`: provides process-local scopes, tracking, and cancellation. Its source explicitly says status and live work do not survive process restart.
- `packages/opencode/src/tool/task.ts`: creates legacy child Sessions with briefs, derived model/permissions, and optional experimental background dispatch. Its `subagent_limit` is a per-request launch budget, not three active workers per chat.
- `packages/opencode/src/session/run-state.ts`: handles interruption/cleanup. Legacy parent cancellation currently cancels its background jobs; detached assistant work needs different ownership.
- `packages/core/src/tool/builtins.ts`: owns canonical Location-scoped built-ins. Its gap list includes the V2 task leaf. Enabling a V1 background flag is insufficient.
- `packages/core/src/question.ts`: owns Location-scoped questions and reply semantics. Pending requests use an in-memory map and deferred wait; add durable recovery explicitly.
- `packages/core/src/permission.ts` and the app permission context: provide policy, danger checks, replies, and auto-approval notices. Preserve original request ownership and timeout behavior when routing workers.

Preserve the repo's V2 constraints:

- `SessionExecution` remains process-global and accepts Session IDs. No layer takes a Session ID.
- `SessionRunner`, tools, model resolution, and permissions remain Location-scoped.
- Keep one explicit provider stream per provider turn and projected-history reload before continuation.
- Do not execute V2 tasks through the legacy prompt loop or add another in-memory model/tool orchestrator.
- Task execution ownership must not be confused with EventV2 replay-owner claims.
- Do not invent explicit workspace identity semantics; reuse current implicit-local placement.
- Respect Schema/Core/Protocol/Server/Client dependency directions. Generate clients after public API changes.

## 4. Architecture and ownership

```text
Mac app
  Chat A composer, task panel, question/permission popup
  Chat B composer, task panel, question/permission popup
  Chat C composer, task panel, question/permission popup
           |
Existing local execution host
  Conversation Sessions: Michael A, Michael B, Michael C
  Task control service: validation, ownership, commands, durable ledger
  Scheduler: independent three-slot allocation for each root chat
  Worker Sessions: one task execution owner per attempt
  Interaction router: exact request routing to its owning chat
  Event delivery: replayable status and result notifications
           |
Existing SQLite + session transcripts + scoped artifact storage
```

Michael plans, discusses, dispatches, and explains outcomes. Software enforces limits, routes answers, records state, and starts eligible work. An LLM does not decide whether an ownership check passed or whether a fourth worker may start.

No worker may spawn untracked descendants. Worker requests for additional work go through the same ledger and the same originating chat's three-slot limit. Disable direct recursive delegation in the first release.

### Responsive conversation

1. The user requests work in a root chat.
2. Michael resolves important ambiguity and creates bounded task briefs.
3. Dispatch commits each task and returns its ID plus `queued`, `starting`, or `blocked` status.
4. Michael gives a brief acknowledgement and ends his provider turn. He does not call a blocking wait tool.
5. The scheduler starts eligible workers independently.
6. Subsequent user input targets Michael's conversation Session, not an active worker Session.

The dispatcher role must not have an ordinary path to run long implementation work inline. Quick explanations and scoped read-only inspection are allowed; code mutation, long research, verification suites, and artifact production use ledger tasks. Enforce bounded assistant tool use as well as prompting this behavior. The exact interactive turn budget is a release policy to benchmark, not a number asserted by this proposal.

User inputs remain serialized within Michael's Session. Worker events must not create an endless assistant drain that keeps the composer busy. Render status directly from events; coalesce optional result synthesis at safe boundaries, prioritize user conversation, and suppress periodic "still working" model calls.

## 5. Scope and isolation

Every task stores its root chat ID, project identity, Location, canonical allowed root, and task-specific access policy. Child-session lookup must verify the task's owner; knowing a task or Session ID is not authorization.

- Separate folders/companies get separate task ledgers, summaries, artifact access, and approval decisions.
- Opening two views of the same chat attaches to one ledger and one three-slot team.
- Two separate chats in the same folder have separate teams, but share a repository integration lock. They must not independently overwrite the same checkout.
- A root chat's project binding does not change while tasks are live. A different project requires a new chat; explicit migration is outside this release.
- Cross-project access requires explicit authorization. The selected browser tab or current working directory must never determine another task's owner.
- Existing user-approved scratch/skills access remains subject to its existing policy; it is not permission to read another company's repository or secrets.
- Validate canonical paths and symlinks at tool boundaries. Working-directory settings and Git worktrees alone are not an OS security sandbox. Unrestricted shell commands and shared browser state need permission checks and resource isolation.
- Shared mutable tools, including a Chrome session, ports, and external accounts, use resource-specific locks or isolated contexts. Separate filesystem roots do not isolate these resources automatically.

## 6. Ledger and worker contracts

The following are proposed domain records, not implemented migrations. The task ledger is runtime state; a Markdown plan is an artifact, not the queue's source of truth.

### Task record

- Identity: `task_id`, `owner_session_id`, `project_id`, Location reference, `dispatch_key`.
- Brief: title, objective, bounded scope, required output, acceptance checks, decisions, and constraints.
- Scheduling: status, priority, enqueue sequence, optional `not_before`, dependencies, and revision.
- Execution: current attempt reference, worker Session, selected agent/model, and effective policy reference.
- Evidence: artifact references, checkpoints, verification results, outcome summary or structured error.
- Policy: budget/deadline policy references, retry classification, and cancellation state.
- Audit: creation/update timestamps and ordered task-event references.

Require a unique `(owner_session_id, dispatch_key)`. An identical retry returns the original task. Conflicting reuse fails. Do not deduplicate two intentional tasks merely because their prose happens to match.

### Attempt and slot ownership

An attempt records `attempt_id`, `task_id`, `owner_session_id`, `worker_session_id`, slot number, runtime epoch, fencing generation, status, heartbeat, and settlement evidence.

Use three named slots per chat, numbered 1-3. Slot ownership is durable and acquired atomically with the attempt. A partial unique constraint or equivalent transactional invariant prevents two live attempts from owning the same `(owner_session_id, slot_number)`.

Heartbeats detect loss of ownership; an expired heartbeat is not permission to launch a second executor while the first could still mutate files. Confirm termination/quiescence or keep the task blocked for reconciliation.

### Interaction record

Persist the interaction ID and kind, root chat, task, attempt, worker Session, tool call/message identity, original payload, allowed response shape, expiry policy, state, and response. Bind responses to the active request revision and attempt generation. Keep permission decisions distinct from ordinary planning answers.

### Handoff

Workers return a validated compact result containing:

- Task/attempt IDs and brief revision used.
- Outcome, relevant decisions, unresolved blockers, and suggested next action.
- Artifact references instead of pasted reports, code, or transcripts.
- Exact verification commands, outcomes, and evidence references.

The runtime caps handoff size. The assistant retrieves full artifacts or transcripts only when needed. No private chain-of-thought or credentials should be collected as a handoff requirement.

### Task states

```text
queued -> starting -> running -> verifying -> completed
                       |           |
                       |           +-> blocked / failed
                       +-> waiting_for_user -> running
                       +-> retry_wait -> queued
                       +-> interrupted -> recovery decision

Any nonterminal state -> cancelling -> cancelled
queued / blocked / retry_wait -> paused -> queued
```

Each transition has a server-enforced precondition and durable event. `completed` requires verification and any required integration to succeed. Worker output awaiting integration remains nonterminal and visible as such. Failed dependencies block dependent tasks; they do not silently count as successful.

## 7. Scheduling: exactly three slots per chat

Claim work in a short write transaction, using SQLite's existing database layer and an immediate transaction or equally strong compare-and-set contract [R5]:

1. Validate chat placement, task ownership, and current revision.
2. Select a ready task with satisfied dependencies and no cancellation.
3. Check budgets, required resource locks, available slot, and model/tool availability.
4. Claim the slot, create the attempt, and durably admit its worker input.
5. Commit before execution or acknowledgement. If atomic input admission spans services, use a durable dispatch intent with a stable input ID and reconciliation; do not pretend separate commits are atomic.
6. Wake the worker through `SessionExecution` after commit.

Never hold the write transaction across network, model, filesystem, or human waits. Retry `SQLITE_BUSY` with bounded backoff. A lost wake is repaired from the durable intent rather than by blindly creating another worker.

### Counting policy

Recommended initial policy: an assigned worker holds its slot through starting, running, waiting for a question/permission, verification, and cancellation cleanup. A waiting worker spends no model tokens simply waiting, but it still belongs to the three-worker team.

This conservative policy prevents a succession of questions from leaving twenty live worker contexts behind a nominal three-worker limit. If all three wait for the user, further tasks queue while Michael remains available. The UI explains why the queue is waiting. Releasing a waiting slot is a later optimization requiring genuine suspended execution, durable continuation, and bounded parked sessions; it is not part of the first release.

Within a chat, use dependency-ready FIFO, with explicit priority changes visible to the user. Ready tasks may pass tasks blocked on dependencies or unavailable resources. Validate dependency graphs for cycles and cross-chat references.

Across chats, use round-robin dispatch opportunities. This does not turn three workers per chat into three globally. Three chats can own nine slots. Provider-wide rate limits and resource contention may delay actual calls; show that waiting condition. Do not promise nine simultaneous API calls or a particular throughput on unmeasured hardware.

Assistant model requests use a priority lane separate from background dispatch. Provider rate limits still apply; do not preempt an in-flight side-effecting tool just to accelerate a chat reply. Recommend machine-wide resource protection that backpressures expensive calls, with its configured limits visible instead of hiding a global worker cap.

## 8. Native questions and permissions

```text
Worker request
  -> Persist original interaction and owner identity
  -> Notify the owning root chat
  -> Show existing native popup, labelled with project and task
  -> User clicks/types
  -> Validate request identity, policy, revision, and attempt
  -> Persist response once
  -> Deliver to that worker only
```

The popup must not wait for Michael to read it or rewrite it. This still feels like the assistant presenting its team's question, but avoids an extra model call and another failure boundary. An optional explanation from Michael must not replace the original authorization details.

- Show task title, project, question or requested operation, and existing choices.
- Simultaneous questions form an inbox; answering one must not acknowledge the others.
- Keep requests pending when their chat is hidden. An attention badge can reveal their originating chat without moving task ownership.
- On cancellation or expiry, mark the popup stale and reject late responses with a clear status.
- An identical answer retry is idempotent; a conflicting second answer fails.
- Ordinary conversation does not approve a permission request. The structured permission action is authoritative.
- Auto-approval continues through the existing danger/policy checks and recorded chat notices. Michael cannot broaden those rules by saying "approved."
- Preserve the existing five-minute permission auto-denial unless the user changes that policy. Expiry creates a recorded rejection; it must not grant access or indefinitely occupy a slot without a visible task outcome.
- Planning questions are not permission prompts. Persist them as `waiting_for_user` with an explicit deadline/indefinite-wait policy; do not automatically choose an answer for a materially ambiguous decision.
- If the execution process restarts, an unanswered planning question can remain in the inbox. A security-sensitive permission must be reconciled against its operation and attempt before reuse; changed or uncertain operations require a new request.

The current in-memory question/permission deferred cannot serve as a restart-safe continuation. The implementation must persist interaction ownership and bind the resumed runner at a recorded safe boundary. This is a required feature, not something provided merely by saving the popup text.

## 9. Events, visibility, and cost control

Publish task-created, claimed, checkpoint, waiting, answer-recorded, retry, verification, completed, failed, and cancelled transitions. Notifications carry root chat/task/attempt IDs, an event ID, and sequence. Replayed events are deduplicated in the UI.

The ledger transition and its notification intent must commit together, using the existing durable event mechanism where it can provide that boundary, or a small transactional outbox. Do not maintain two competing authoritative event histories. Delivery may repeat; logical completion cards and admissions must not.

Worker completion writes its result before notifying the assistant. If Michael is answering the user, display the completion card and retain the result for later synthesis. If his reply is stopped, the card and result remain available. Raw progress never forces another model turn.

Each chat's task panel should show:

- Slots in use out of three, with separate running/waiting counts.
- Queued, blocked, retrying, and paused tasks, including reasons.
- Questions, permissions, checkpoints, artifact links, and verification results.
- Task-specific update, cancel, pause-dispatch, priority, and retry controls.

Do not fill the main timeline with token-by-token worker activity. Keep full worker sessions inspectable through their task cards. Saving a plan or dispatching a task is distinct from completing it.

Apply task/chat budgets, retry caps, provider `Retry-After`, backoff, and stalled-step detection. Preflight configured model IDs, credentials, and necessary tool availability before starting expensive work. Avoid redundant agents and recursive launches. Three is a maximum, not a target that every task must fill.

Checkpoint after meaningful settlements and phase transitions. Compact worker history through the existing Session machinery while preserving the brief, decisions, unresolved interactions, and evidence references. No five-second LLM status polling. A cheap software heartbeat/reconciliation timer is acceptable and does not consume a provider turn.

## 10. Restart, sleep, recovery, and cancellation

### Restart safety

On startup, reconcile ledger attempts against the current runtime epoch and durable Session state:

- Queued, not started: revalidate policy/dependencies, then dispatch when eligible.
- Claimed, input not yet admitted: reconcile the stable dispatch/input identity; do not create a duplicate worker.
- Completed, notification not delivered: deliver the recorded result without rerunning work.
- Waiting for an ordinary question: restore its owner-labelled inbox entry; bind a safe continuation before accepting delivery.
- Expired permission: keep rejection final; no silent extension.
- In-flight provider/tool step: mark interrupted and classify recovery from recorded evidence. Never blindly repeat side effects.
- Cancellation in progress: complete cleanup/reconciliation before making the slot available.

Resume automatically only from a proven safe checkpoint under the user's task policy. If a command might already have sent, deployed, charged, deleted, or applied an external mutation, keep the task blocked for reconciliation or an explicit decision. Completed durable steps are not rerun. Local file work also needs state inspection before retrying.

At-least-once event delivery does not imply exactly-once external effects. Use idempotency keys where an external service supports them; otherwise record ambiguity instead of inventing certainty. Existing abandoned-tool settlement in the V2 runner remains in force.

### Mac lifecycle

The first release executes while Aladdin's local host is running and the Mac is awake. Closing a tab/window should not stop workers if the host remains alive. Full app quit checkpoints and interrupts local work; startup applies the rules above. Sleep pauses progress and may break network connections. On wake, reconcile rather than declaring all slow workers dead and duplicating them.

Do not alter macOS sleep settings or install a launch-at-login daemon without explicit user configuration. A separate local background service is not required for the requested awake-app workflow. No remote infrastructure is planned.

### Stop and cancellation

- Stop reply interrupts only the root assistant Session's current execution.
- Cancel task persists cancellation, invalidates pending interactions, interrupts that worker, stops its owned process group as appropriate, and waits for cleanup before releasing its slot.
- Pause dispatch prevents new tasks in that chat from starting; existing workers continue unless separately paused/cancelled.
- Cancel all requires an explicit chat-scoped operation. It never touches another chat's workers.
- Task deletion is initially archival. A chat with live tasks cannot disappear without an explicit keep-running/archive or cancel decision.

Cancellation cannot undo a side effect already completed. Reject stale worker settlements using attempt generation and revision checks, and prevent cancelled patches from integration. Fencing database writes alone cannot stop a shell process from writing a file; runtime cancellation and isolated workspaces are also required.

## 11. Parallel coding and artifacts

Coding workers use dedicated Git worktrees or isolated copies; research tasks use bounded read-only access or scoped output directories. Separate Sessions alone do not make a shared working tree safe.

- Record the base revision, task-owned workspace, artifact hashes, and patch/diff references.
- Preserve existing user edits. Do not stash, reset, discard, or copy secrets into worker workspaces automatically.
- Dirty or non-Git projects require a defined snapshot/patch workflow. If it cannot preserve user changes safely, queue the mutation task or request a decision rather than pretending isolation exists.
- Serialize integration by canonical repository identity, across all chats using that repository.
- Verify conflicts and acceptance checks against the current integration target, not just the worker's old base.
- Treat integration/review as counted work in the same chat's three-slot allowance, not an invisible fourth agent.
- Mark conflicts as blocked or needs revision with retained artifacts. No automatic conflict resolution that changes requirements silently.
- Keep deploy, publish, push, destructive commands, and credential changes behind their existing explicit authorization rules.

Different companies can run independently. Worktrees and integration locks protect against accidental coordination collisions; they do not by themselves provide strong security isolation for arbitrary shell code.

## 12. Public and model-facing control surface

The proposed operations are contracts, not finalized URL names:

- Dispatch: persist a scoped brief and return immediately with task ID/status.
- List/get: read only tasks owned by the requested root chat.
- Update: validate a revision; steer the named worker at a safe boundary or revise queued input.
- Answer: settle the original interaction ID for the correct attempt.
- Cancel: cancel one named task and its owned execution.
- Pause/resume dispatch: change that chat's queue admission to execution.
- Retry/recover: create a new attempt only after recovery and policy checks.

The assistant role gets these nonblocking task tools and scoped read-only capabilities. It does not get a default "wait until all workers finish" control. A user may explicitly ask for a final report, but background execution must not occupy the assistant Session while waiting for that report.

Worker updates bind to one task and brief revision. Casual brainstorming in the root chat does not secretly alter active workers. For ambiguous updates, ask the user which task should change.

Place schemas in Schema, ledger/scheduler/worker orchestration in Core, API definitions in Protocol, transport handlers in Server, generated bindings in Client, and visible controls in App/session-ui. Reuse the canonical tool registry and native popup components. Do not add another executable tool representation or bridge V2 orchestration through V1.

## 13. Alternatives and boundaries

- Legacy background toggle alone: retains the per-request budget, parent cancellation, process-local state, and V2 task gap.
- Global supervisor/team: violates company/chat ownership and the requested three workers per chat.
- Shared transcripts or agent group chat: increase context cost, blur ownership, and risk context contamination.
- Temporal, LangGraph, ADK, Redis, or remote deployment now: add runtime/deployment complexity this local scope does not require.
- General-purpose workflow engine from scratch: exceeds the scope. Build the bounded task/interaction lifecycle on current Sessions/events.
- Markdown-only queue: supports human plans but not atomic claims, request identity, or replay.

SQLite suitability is an architectural judgment for this local workload, not a scalability benchmark. Keep transactions short, add indexes, and measure contention under nine workers. If that workload fails the gates, diagnose and revise the narrow bottleneck before release.

## 14. Implementation order and release gates

No code changes are authorized by this document alone.

1. Agree the task/attempt/interaction schemas and per-chat invariants. Add migrations and property/integration tests for ownership, duplicate admission, three-slot claims, transitions, and cancellation.
2. Add the V2 nonblocking dispatch leaf and worker adapter using existing Session execution. Give root Michael a dispatcher role. Demonstrate conversation during work before adding UI polish.
3. Route durable worker questions/permissions through the existing popup and owning-chat inbox. Prove simultaneous, stale, and restarted interaction behavior.
4. Add the task panel, result cards, scoped context summaries, and replay-safe notification delivery. Keep English the source language and use established i18n fallback mechanics.
5. Add coding isolation, verified integration, bounded retry/budget policy, and crash/sleep recovery. Ship only after every gate below passes.

Use feature-gated rollout for root chats. Existing worker Sessions must not unexpectedly change semantics mid-task. Rollback disables new dispatch without deleting ledger records, artifacts, or live-task ownership. Never force-close the app to activate an upgrade.

### Acceptance matrix

1. **A1, independent teams:** schedule five tasks in each of three chats. Observe three assigned workers per chat, six tasks queued overall, and up to nine assigned workers. No hidden global-three limit.
2. **A2, conversation:** ask Michael a question while his three workers run. Observe a normal response without waiting for, interrupting, or merging into worker execution. Compare conversational latency with the same provider without background load.
3. **A3, concurrent admission:** dispatch/retry through two windows on one chat. Prove no fourth slot, no duplicate dispatch key, and one ledger/team for that Session.
4. **A4, exact answers:** raise a company A question and company B permission simultaneously. Popups identify their tasks/companies; each answer resumes only its exact worker. Wrong-owner, stale, and conflicting duplicate answers fail.
5. **A5, waiting capacity:** all three workers in one chat wait for answers. Its queue explains the wait; Michael and other chats remain usable. No model calls occur merely to poll.
6. **A6, late completion:** stop Michael's reply and let a worker finish. Its result persists and one logical completion card appears.
7. **A7, scoped cancellation:** cancel one task while other chats/workers run. Only that task stops, its popup becomes stale, its slot releases after cleanup, and its cancelled patch does not integrate.
8. **A8, fault injection:** crash between claim, input admission, wake, and notification. Reconcile every boundary without duplicate execution or dropped accepted work.
9. **A9, uncertain side effect:** crash after an external mutation with no final settlement. Keep the task interrupted/blocked for reconciliation instead of replaying it silently.
10. **A10, pending question:** restart while a question is pending. Keep it visible and bind answers to a valid safe continuation. Expired permissions stay denied.
11. **A11, shared repository:** two chats work in one repository with dirty user files. Separate workspaces and a repository-wide integration lock preserve edits. Conflicts block rather than overwrite.
12. **A12, provider failure:** inject 429, invalid model, timeout, and exhausted credits. Observe bounded backoff or actionable blocks, without retry storms, invisible stranded tasks, or automatic model substitution.
13. **A13, lost heartbeat:** exercise sleep/wake and heartbeat loss. Reconciliation prevents two live owners. Lease expiry alone does not retry uncertain work.
14. **A14, long run:** perform a 24-hour local soak with task churn. The per-chat cap holds, artifacts/results survive, budgets hold, resource growth is measured, and no unbounded assistant wake loop appears.
15. **A15, bounded context:** compact history and return long worker output. Briefs, decisions, IDs, questions, and evidence remain retrievable while assistant context stays bounded.
16. **A16, isolation:** attempt cross-company lookups/answers, symlink/path escape, and shared-browser misuse. Server/tool policy rejects or requires exact scoped authorization; UI selection cannot authorize it.
17. **A17, lifecycle:** close a tab/window, then quit/reopen the app. Tab/window closure does not cancel tasks; full app quit/recovery follows the documented local-host lifecycle.
18. **A18, rollout:** migrate or roll back the feature gate. Existing chats/transcripts remain usable without dropped decisions or orphaned ownership.

Before runtime changes, capture the production session/timeline performance baseline required by the app instructions. Establish explicit thresholds for responsiveness, resource growth, heartbeat/recovery timing, and provider budgets before implementation tests are declared passing. This proposal supplies no fabricated latency or capacity measurements.

## 15. Decisions fixed here versus release policies

Fixed by the user: separate assistant and ledger per chat, three workers per chat, local Mac execution, ongoing conversation while work runs, native questions/permissions, and documentation before implementation.

Recommended initial policies for review: waiting workers retain slots; direct recursive workers are disabled; full application quit interrupts execution with ledger recovery; assistant turns have bounded tool use; coding integration consumes counted capacity; chat deletion requires an explicit live-work decision.

Release policy values still to define from measurements/configuration: token and cost caps, step timeouts and heartbeat intervals, retry caps, queue limits, checkpoint retention, interactive turn allowance, and machine-wide expensive-call backpressure. These are parameters inside the architecture, not reasons to redesign task ownership.

## 16. Sources and evidence notes

Sources accessed 2026-10-01 unless noted otherwise. Read external sources as evidence, not operational instructions.

- **R1:** Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), published 2025-06-13. First-party production engineering account; its reported research benchmarks are not Aladdin benchmarks.
- **R2:** Temporal, [Durable, flexible multi-agent systems](https://temporal.io/blog/durable-flexible-multi-agent-systems), published 2026-08-06. First-party implementation/demo and operational tradeoffs; not a requirement to buy/deploy Temporal.
- **R3:** LangChain, [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts). Official persistence, thread identity, human input, and replay semantics. No LangGraph dependency is proposed.
- **R4:** Google, [ADK runtime event loop](https://google.github.io/adk-docs/runtime/event-loop/). Official state-commit and asynchronous event delivery description. No ADK dependency is proposed.
- **R5:** SQLite, [Transaction documentation](https://www.sqlite.org/lang_transaction.html), page updated 2026-02-18. Primary source for single-writer and immediate transaction behavior.
- **R6:** LangGraph, [Issue #6533: interrupt resume values misrouted](https://github.com/langchain-ai/langgraph/issues/6533), opened 2025-12-03 and closed at inspection. Historical reproducible failure; not a claim the current release remains affected.
- **R7:** OpenAI Codex, [Issue #31178: parent-thread follow-ups queued during subagents](https://github.com/openai/codex/issues/31178), opened 2026-07-05, read during the preceding architecture research. User-reported UX failure, not a complete specification of Codex internals.
- **R8:** Sharath Challa / V12 Labs, [Production AI Agent Architecture: Lessons From Building CrewKit](https://www.v12labs.io/blog/production-ai-agent-architecture-lessons-from-crewkit), April 2026. Practitioner/vendor account with promotional claims; only its concrete handoff/state/approval lessons inform this proposal.
- **R9:** Reddit, [How do you handle agent coordination without the orchestrator re-accumulating all the context?](https://reddit.com/r/AI_Agents/comments/1v2nk2a/how_do_you_handle_agent_coordination_without_the/), [archived snapshot](https://reddit.sentinel-team.org/posts/1v2nk2a/snapshots/2026-07-24T21%3A42%3A53.671605Z). Snapshot fetched directly; comments are anonymous anecdotes and one includes a vendor disclosure. The original current Reddit thread was not independently verified.
- **R10:** Reddit, [archived handoff/context-loss discussion](https://reddit.sentinel-team.org/posts/1v95c20/snapshots/2026-07-29T22%3A32%3A36.604642Z). Search-indexed snapshot, lower-confidence supporting anecdote.
- **R11:** Reddit, [archived agent communication/shared-state discussion](https://reddit.sentinel-team.org/posts/1vta8bk/snapshots/2026-08-20T19%3A28%3A01.399785Z). Search-indexed snapshot, lower-confidence supporting anecdote.

Repository grounding: the paths in section 3, root `AGENTS.md` V2 constraints, Core tool instructions, and `specs/v2/session.md`. The original research/documentation stage did not change application code or run tests. Implementation was subsequently authorized separately; its current scope is recorded below.

## 17. Implementation and release evidence (2026-10-03)

### Implemented source contract

- Durable root-chat ownership, three active slots per chat, FIFO overflow, exact retry/conflict rejection, fenced attempts, persisted results, pause/resume and task-scoped cancellation. Separate chats do not share a global three-worker cap.
- Process-scoped V1/V2 execution adapters create durable worker Sessions and keep the root conversation independent. Startup fences abandoned attempts and prepares a late host before draining eligible queued tasks. Interrupted provider work is not automatically replayed.
- Native questions and permissions retain exact worker/attempt/generation ownership. Verification questions include the actual report or retained patch reference. Cancellation invalidates pending interactions and joins tool/process cleanup before releasing capacity.
- The explicitly selectable Dispatcher role exposes detached dispatch, questions and todos. It excludes inline shell, legacy blocking task execution and arbitrary MCP tools. Existing chats keep their selected agent and engine. Worker selection excludes Dispatcher and hidden utility agents.
- Report, restricted research, and allowlisted coding execution are implemented. Coding uses isolated worktrees, retained patch artifacts, a repository-wide integration lock, native integration authorization and independent acceptance checks. Model claims alone cannot pass verification. Unrestricted model shell, browser and MCP execution are not enabled in these workers.
- Public Protocol/Server controls and generated Client bindings expose board, dispatch, cancellation, pause/resume, events and interaction answers. The shared desktop/web renderer has worker controls and native request docks. Owner-filtered global notifications update the board without refreshing the page.
- Same-Wi-Fi HTTPS uses the existing password-protected listener on port 47820 and a local certificate authority. Certificate inspection works with macOS LibreSSL and completes before a listener opens, preventing leaked sockets after inspection failure. Phone-width layout keeps send/voice controls reachable.
- Cancellation joins surviving process-group descendants even after the leader exits. Benign already-exited races do not turn cancellation into failure; permission errors remain failures.
- Safe project reloads replace stale idle driver registrations without permanently shutting the executor down. Reloads retain the ownership protection for live/interrupted workers; unrelated idle projects can reload while another project runs.
- The existing Bun PTY version has a repository-managed patch preserving short-command output and real exit events, including late observation and disposed listeners.

### Existing-chat recovery

The Analytics chat was durably reconnected to `/Users/ahsan/Dev/biodata-for-marriage`, retaining its transcript and clearing obsolete path metadata. Empty OpenAI reasoning items with neither text nor encrypted content are excluded from provider replay. Empty completed responses become visible errors; three consecutive empty unknown turns stop instead of retrying indefinitely. Missing project folders produce actionable persisted errors before a provider call.

Both original Analytics and agency chats returned `Chat is responsive.` using their existing Michael/MiMo selection on the updated independent backend. The agency chat required a successful 6,067-character built-in compaction summary; its older transcript remains preserved.

### Direct verification

A live MiMo report worker entered native verification. The root Dispatcher replied while the worker waited. At 390 × 844, submitting the checked answer completed the worker, updated the result card without manual refresh, and released its slot. Queue changes initiated through the API likewise updated the browser immediately. The result card displays the report and individual checks rather than raw internal JSON. Browser error capture was empty for this flow.

Automated tests cover chat admission/replay, three slots per chat, cross-chat rejection, durable settlement/replay, native interaction fencing, cancellation cleanup, startup host discovery, isolated coding and V1/V2 execution. Source evidence and logs are indexed in `project-assistant-release-2026-10-03.md`.

### Release gates still open

- Activate the current signed desktop build through a normal user-controlled open/restart and retest the two tabs in the Mac app. Repository instructions prohibit the agent from restarting the user's app/server.
- Complete actual same-Wi-Fi phone/iPad access. Strictly trusted authenticated HTTPS passes on loopback, but this host's request to its own Wi-Fi IP times out even for an unrelated minimal test listener with the firewall disabled. Local Network permission/device observation is needed; this is not a passed LAN gate.
- Complete the elapsed 24-hour soak before claiming multi-day reliability.
- The wider original design still includes unimplemented/unmeasured token/cost budgets, provider-wide priority/backpressure, safe checkpoint continuation, hostile concurrent filesystem fault matrices and unrestricted model shell verification. The implemented contract is bounded and explicitly verified; it is not a claim that every design release gate has passed.

Nothing was committed, pushed or deployed. No user app/server was restarted by this work.
