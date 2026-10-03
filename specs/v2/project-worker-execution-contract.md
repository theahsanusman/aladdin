# Detached project worker execution contract

This slice is opt-in. It does not change desktop's V1 default, adopt existing chats, or replace the legacy `task` tool. Modes are `report` (no tools), `research` (native read/glob/grep/question), and `coding` (those tools plus native edit/write in a dedicated detached Git worktree). No mode enables unrestricted shell, deploy/push, browser, arbitrary MCP/plugin tools, or recursive delegation. Host verification commands are separate trusted capabilities, not model-controlled shell access.

## Durable contract and schema

`Task.Brief.execution` is an optional immutable snapshot containing:

```ts
{
  engine: "v1" | "v2"
  agent: string
  model: { id: string; providerID: string; variant?: string }
  mode: "report" | "research" | "coding"
  paths?: string[]       // coding requires safe relative mutation paths
  baseRevision?: string // coding requires accepted full Git HEAD hash
  maxCalls: number       // integer, 1–100 provider-turn admissions
  maxToolCalls?: number  // integer, 1–1,000; default maxCalls * 20
  wallClockMs: number    // integer, 1–86_400_000; work plus verification
}
```

It is stored in the **existing brief JSON column**. There are no new SQL columns/tables or generated migration files in this slice. The complete snapshot participates in ledger exact-retry equality. Old briefs without execution stay ledger-only and are not silently configured. Immutable scope remains the brief's scope/constraints plus the ledger's root-derived project/Location binding. Explicit workspace placement is not supported by these drivers.

Claims retain the existing predetermined worker Session/input IDs, three slots per root, generations, and epochs. Results and independently obtained check evidence are compact JSON in the existing attempt evidence/journal settlement; no second event history is introduced. A successful result requires a nonempty summary, exactly one passing evidence-bearing result for each required check, verification state, successful cleanup, and a handoff of at most 20,000 characters. Worker output alone does not satisfy checks.

## Core API

Build **one** `TaskExecution.node` in the application-global memoized layer graph. It depends only on `TaskLedger.node` and `TaskInteractionStore.node` (and their Database), never LocationServiceMap or SessionExecution.

- `dispatch(Task.Dispatch)` commits admission, schedules a software wake, and returns `Task.Info` without waiting for execution.
- `register(Driver)` late-registers one `(engine, canonical directory)` driver for the executor's application lifetime. Duplicate registration fails. Registration wakes eligible durable queues. Build drivers in app bootstrap, not assistant/request/view scopes.
- `wake(rootSessionID)` coalesces queue notifications. FIFO within a root; one claim per queue opportunity; roots independently retain their three durable slots. Invoke after explicit ledger retry/reconcile or other external admission. No model polling.
- `cancel({ownerSessionID, taskID})` persists cancellation, invalidates interactions, interrupts only that worker, joins cleanup, then settles. Invalidation failure still interrupts execution but retains capacity for reconciliation.
- `startup()` fences attempts from previous epochs and wakes queued owners. Call only from the **single owning execution host**, not each window or an arbitrary competing process. It does not prove an old host/process stopped, release interrupted slots, or replay ambiguous work.
- `beforeCall(workerSessionID, engine?)` enforces current ledger ownership and the immutable call allowance, returning the execution policy. Ordinary conversational Sessions return `undefined`; historical worker Sessions without live process ownership are rejected. Engine-qualified decorators avoid charging V1's optional native transport twice.
- `workerContext(workerSessionID)` returns the live task/attempt/execution snapshot plus the actual bound worker directory. It rejects cancelled/interrupted/historical execution and includes the verifying phase for host integration authorization. `TaskLedger.worker(workerSessionID)` is a durable identity lookup, including historical attempts; do not confuse that with a live ownership claim. Native hooks use its attempt ID/generation to call the unchanged interaction store, which performs the authoritative live join/fence.
- `beforeTool(workerSessionID)` enforces the tool admission budget; `pinned(directory)` identifies root/isolated Instances that cannot be disposed while durable ownership remains.
- Provider guards reject model changes, including an implicit fallback/compaction model outside the accepted selection. The V2 driver binds the native API ID resolved from the selected catalog model so catalog/API aliases do not become false substitutions.
- `pause(root)` / `resume(root)` persist chat admission control and prevent new dispatch without interrupting running workers. Restored hosts read the durable pause state before admitting work.
- `idle(root)` is a host/test observation barrier, not a model-facing wait tool. It means local work/wakes drained, not that every durable task succeeded (missing drivers, unconfigured tasks, or retained interrupted slots may remain).
- `error(root)` exposes the latest local scheduling/cleanup failure. Durable execution failure/results remain in the ledger journal.
- `shutdown()` stops admissions/wakes, fences this epoch and joins active cleanup. Call before tearing down captured Session/provider/Instance services; scope closure is also a safety net. Full shutdown retains interrupted slots for separate cleanup-proof reconciliation.

The unchanged ledger's `reconcile` still requires current generation and explicit cleanup evidence before releasing interrupted slots. Retry is separate and explicit. Do not treat heartbeat loss, timeout, sleep, or the current epoch's mere absence as cleanup proof. No automatic provider retry/model substitution is implemented by this scheduler.

## Drivers and provider guards

`Driver` has `engine`, `directory`, `run(task, attempt, budget)`, optional `verify(task, result, attempt)`, and `cleanup(attempt)`. Worker fibers are forked into the executor's scope, not the caller's. Cleanup failure/interruption/settlement storage failure preserves ownership and fences the failed attempt; one failed driver does not kill the queue consumer.

Install the mandatory provider decorators **before** constructing the services that capture them:

- `TaskWorkerGuards.v1(rawSessionLLM, executor, filesystem)` decorates opencode `LLM.Service`. It filters native tools by immutable mode, wraps their existing executors before the SDK can run them, checks canonical paths/symlinks/scope and tool budgets, disables SDK internal retries, and counts provider-turn/retry admissions. Report mode alone forces tool choice none.
- `TaskWorkerGuards.v2(rawLLMClient, executor, filesystem)` decorates native `LLMClient.Service`. Every Location SessionRunner must capture it. Session-affinity headers also cover native compaction. It filters canonical definitions and fences/validates/counts each local call before canonical settlement. Provider-hosted calls are rejected. It adds no legacy conversion or provider/tool loop.
- `TaskWorkerPermissionGuards.v1Node` / `.v2Node` repeat scope checks at the native permission boundary, reject external-directory escalation, and forward to the original permission service. Native popup payloads, danger rules, replies and expiry remain native. The V2 decorator fills omitted save/metadata with empty values because the current native request producer includes explicit undefined keys that fail event encoding; main should correct omission handling in the native producer rather than fabricating tool source identity.

Decorator construction records guard installation. Driver construction fails closed if its engine's decorator was omitted. This marker is not a substitute for building the correct layer graph: constructing a decorated client and then supplying the raw client elsewhere is invalid bootstrap.

Ready-made replacement nodes preserve the raw provider dependencies and share the same executor/DB. Apply these replacements in the owning application graph (including the V2 Location graph), rather than building another runtime:

```ts
;[
  [LLM.node, TaskWorkerGuards.v1Node],
  [LayerNodePlatform.llmClient, TaskWorkerGuards.v2Node],
  [Permission.node, TaskWorkerPermissionGuards.v1Node],
  [PermissionV2.node, TaskWorkerPermissionGuards.v2Node],
  [InstanceStore.node, TaskWorkerBootstrap.instanceNode],
  [Format.node, TaskCodingServices.formatNode],
  [LSP.node, TaskCodingServices.lspNode],
]
```

`LLM` here is opencode's Session LLM service. These decorators do not enable native/V2 execution flags. Both can coexist while the installed desktop continues running V1.

The Format/LSP decorators are mandatory for V1 coding: they suppress implicit formatter and language-server processes only in task-owned isolated coding Instances, before project bootstrap can initialize them. Root chats are unchanged. Their installation is checked by the V1 worker driver. Existing native file tools still execute; no alternative file-tool representation is introduced. Driver factories use the executor's `inHostScope`, and isolated Instance/Location services are disposed after native cleanup while the durable slot is still held.

Then late-register one combined ordinary/coding driver per engine/root in app-global bootstrap:

```ts
const executor = yield * TaskExecution.Service
// Under the actual V1 owning InstanceRef, with app-global service lifetime:
yield * TaskWorkerBootstrap.v1({ storage, verify, codingChecks })
// Or under the matching canonical V2 Location services:
yield * TaskWorkerBootstrap.v2({ directory, storage, verify, codingChecks })
```

`verify(task, output)` and `codingChecks(workspace, artifact, task)` are required host callbacks returning `{check, passed, evidence}[]`. Coding checks run against the isolated workspace and again against the integrated root under the repository-wide integration lock. Implement real checks; reject unsupported checks rather than trusting worker claims. Verification and native integration authorization remain inside the durable verifying phase and wall-clock budget. Completion and slot release wait for actual native cleanup.

`storage` must be an existing app-owned directory outside the user's repository. `TaskCodingDriver` creates a locked detached worktree named by attempt ID from the accepted base revision, never copies dirty root files or stashes/resets them, and retains worktrees/hashed patch files for inspection. Git hooks, external diff/textconv, fsmonitor and configured clean/smudge/process filters are disabled for runtime Git operations. Patch files are written alongside worktrees, not into them. Existing attempt directories require reconciliation instead of reuse. Integration verifies patch paths/digest, checks root HEAD and a clean index/worktree, obtains native task_integrate authorization, checks fencing again, applies the patch, and runs target checks while holding a canonical git-common-directory lock across all chats. Dirty or changed roots fail visibly with retained artifacts; they are never overwritten or automatically rebased. A post-integration check failure cannot undo an already authorized side effect and must be reconciled explicitly.

Native integration authorization is policy-governed and may auto-approve under existing user rules. A V2 policy that requires an integration popup also requires main's native request producer to omit undefined optional `source` properties (rather than emitting them as explicit undefined); the task workstream does not fabricate a tool call to satisfy that bug. Native durable hooks must identify the worker Session and its actual isolated placement, not route replies to the root directory's pending map.

For the native hooks: look up `TaskLedger.worker(originalRequest.sessionID)`, then use its attempt ID/generation with the unchanged interaction store. On a new request, only `running` transitions to `waiting_for_user`; a verification/integration request keeps `verifying`. On a decided interaction, persist the exact answer, restore `waiting_for_user` to `running` when applicable, then deliver to the owning native deferred in its actual worker placement. Do not transition `verifying` back to model execution. Cancellation and every terminal worker settlement call the store's invalidate method before releasing capacity; invalidation failure keeps the slot for reconciliation.

V1 captures the exact owning InstanceRef, validates project/directory, creates the worker with the durable shared Created event (the legacy public `create` API cannot accept predetermined IDs), admits one native durable legacy user message with `noReply`, and runs existing SessionPrompt orchestration. V2 uses SessionStore, the durable shared Created projector, EventV2/SessionInput admission, and SessionExecution's canonical native runner. V2 never imports/calls SessionPrompt. Explicit `resume` is used because it joins the drain and propagates errors; an advisory wake alone is not completion evidence.

Install `TaskWorkerBootstrap.instanceNode` in every host graph that exposes V1 InstanceStore. It rejects explicit reload/disposal of pinned root/worker directories. Routine idle disposal invalidates driver registrations and rebuilds them on later dispatch; it does not permanently shut down the process executor. Live/interrupted ownership blocks disposal until cancellation/reconciliation. Final host-scope shutdown interrupts and joins workers before destroying Instance services. Underlying private disposal paths must not bypass this boundary. V2 continues through its application-owned LocationServiceMap and SessionExecution. Never register drivers from a tab/request/assistant scope.

## Model-facing leaf and main-agent hookup

`TaskDispatchTool.node` is an optional Location leaf named `task_dispatch`, using the canonical Tool.make/Tools registration. It depends on the process executor, not vice versa. Input is `{dispatchKey, brief}`; ownership comes from the native invocation Session, never an input owner ID. Existing ledger admission rejects child Sessions, preventing recursive teams. The leaf checks native dispatch permission, commits, and returns `{taskID,status}` immediately. The separate opted-in Dispatcher role exposes it; it does not overwrite V1 `task`.

For installed V1 roots, expose the separate opt-in `TaskDispatchV1.Tool` from `opencode/src/task/dispatch-v1.ts` in the native V1 registry. It uses the existing native `define`/context/permission representation and rejects a V2 engine selection. The canonical Core dispatch leaf correspondingly requires V2. Neither switches existing chat engines. Main owns registry/role activation; the old native task tool remains untouched.

HTTP/UI/native integration must use the existing root ownership checks, bind engine selection to the chat's actual runtime, and deliver compact journal results without waking the assistant model. Do not switch V1 chats to V2 to use this API. Main owns native question/permission routing, transport, feature gates, independent verification policy, and migration generation for its interaction changes.

## Remaining release gates

Shell-based coding/verification by the model, provider-wide priority/backpressure, safe checkpoint continuation, live-provider fault matrices, hostile concurrent filesystem races, and the 24-hour soak remain unimplemented/unmeasured. Durable pause/resume, native interaction delivery, transport/UI and app bootstrap are implemented; actual installed-app and LAN device verification remain release gates. Worktrees and path gates are not an OS sandbox for trusted installed plugins/LSP/formatters or arbitrary host check callbacks. The runtime does not advertise shell access as safely isolated. Main still owns native durable interaction delivery/recovery, transport/UI, app bootstrap feature gates, and release measurements.
