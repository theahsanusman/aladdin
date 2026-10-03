import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Scope, Exit } from "effect"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { TaskLedger } from "../src/task/ledger"
import { TaskExecution } from "../src/task/execution"
import { SessionID } from "@opencode-ai/schema/session-id"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, TaskLedger.node])))
const a = SessionID.make("ses_execution_a")
const b = SessionID.make("ses_execution_b")
const c = SessionID.make("ses_execution_c")
const brief = {
  title: "Report",
  objective: "Explain the supplied facts",
  scope: ["Supplied facts only"],
  output: "A report",
  checks: ["Nonempty report"],
  constraints: ["No mutations"],
  execution: {
    engine: "v2" as const,
    agent: "worker",
    model: { id: "test", providerID: "test" },
    mode: "report" as const,
    maxCalls: 2,
    wallClockMs: 10_000,
  },
}
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: ProjectID.make("execution"), worktree: AbsolutePath.make("/execution"), sandboxes: [] })
  yield* database.db.insert(SessionTable).values(
    [a, b, c].map((id) => ({
      id,
      project_id: ProjectID.make("execution"),
      directory: "/execution",
      slug: id,
      title: id,
      version: "test",
    })),
  )
})
const dispatch = (runtime: TaskExecution.Interface, key: string, ownerSessionID = a) =>
  runtime.dispatch({ ownerSessionID, dispatchKey: key, brief })

it.live("detaches admitted work from request scope and drains FIFO independently for each chat", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "one" })
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const order: string[] = []
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: (task, attempt, budget) =>
        Effect.gen(function* () {
          yield* budget.call
          order.push(task.dispatchKey)
          if (order.length === 9) yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          return {
            summary: "Report",
            checks: [{ check: "Nonempty report", passed: true, evidence: "Report contains text" }],
          }
        }),
      cleanup: () => Effect.succeed("No child processes remain"),
    })
    yield* Effect.scoped(
      Effect.forEach([a, b, c], (owner) =>
        Effect.forEach(["1", "2", "3", "4"], (key) => dispatch(runtime, `${owner}:${key}`, owner)),
      ),
    )
    yield* Deferred.await(started)
    expect(order).toHaveLength(9)
    expect((yield* ledger.list(a)).filter((x) => x.status === "queued")).toHaveLength(1)
    yield* Deferred.succeed(release, undefined)
    yield* runtime.idle(a)
    yield* runtime.idle(b)
    yield* runtime.idle(c)
    expect(order.filter((key) => key.startsWith(a))).toEqual([`${a}:1`, `${a}:2`, `${a}:3`, `${a}:4`])
    expect((yield* ledger.list(a)).every((x) => x.status === "completed")).toBe(true)
    expect((yield* ledger.list(b)).every((x) => x.status === "completed")).toBe(true)
    expect((yield* ledger.list(c)).every((x) => x.status === "completed")).toBe(true)
  }),
)

it.live(
  "sustains repeated multi-chat dispatch, exact retries and cleanup without leaking worker slots",
  () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "endurance" })
      const active = new Map<SessionID, number>()
      const maximum = new Map<SessionID, number>()
      const runs = { count: 0, cleaned: 0 }
      yield* runtime.register({
        engine: "v2",
        directory: AbsolutePath.make("/execution"),
        run: (task, _attempt, budget) =>
          Effect.gen(function* () {
            yield* budget.call
            runs.count++
            active.set(task.ownerSessionID, (active.get(task.ownerSessionID) ?? 0) + 1)
            maximum.set(
              task.ownerSessionID,
              Math.max(maximum.get(task.ownerSessionID) ?? 0, active.get(task.ownerSessionID) ?? 0),
            )
            yield* Effect.sleep("1 millis")
            return {
              summary: "Verified facts",
              checks: [{ check: "Nonempty report", passed: true, evidence: "Measured output" }],
            }
          }),
        cleanup: (attempt) =>
          Effect.sync(() => {
            active.set(attempt.ownerSessionID, (active.get(attempt.ownerSessionID) ?? 0) - 1)
            runs.cleaned++
            return "Joined"
          }),
      })
      for (let batch = 0; batch < 80; batch++) {
        yield* Effect.forEach(
          [a, b, c],
          (owner) => Effect.forEach([0, 1, 2, 3, 4], (index) => dispatch(runtime, `${batch}:${index}`, owner)),
          { concurrency: "unbounded" },
        )
        const first = yield* dispatch(runtime, `${batch}:0`)
        expect((yield* dispatch(runtime, `${batch}:0`)).id).toBe(first.id)
        yield* Effect.forEach([a, b, c], (owner) => runtime.idle(owner), { concurrency: "unbounded" })
        expect(yield* ledger.live()).toHaveLength(0)
        if (batch % 10 === 0) yield* runtime.startup()
      }
      expect(runs).toEqual({ count: 1200, cleaned: 1200 })
      expect([...active.values()]).toEqual([0, 0, 0])
      expect([...maximum.values()].every((value) => value <= 3)).toBe(true)
      const board = yield* ledger.board(a)
      expect(board.counts.completed).toBe(400)
      expect(new Set(board.data.map((item) => item.task.id)).size).toBe(board.data.length)
    }),
  30_000,
)

it.live("repairs a lost wake and fences restart attempts without releasing or replaying them", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const task = yield* ledger.admit({ ownerSessionID: a, dispatchKey: "old", brief })
    const old = yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "old" })
    if (!old) return yield* Effect.die("Missing claim")
    yield* ledger.admit({ ownerSessionID: b, dispatchKey: "lost-wake", brief })
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "new" })
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () =>
        Effect.succeed({
          summary: "Report",
          checks: [{ check: "Nonempty report", passed: true, evidence: "Text exists" }],
        }),
      cleanup: () => Effect.succeed("Stopped"),
    })
    yield* runtime.startup()
    yield* runtime.idle(b)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("interrupted")
    expect(yield* Effect.flip(ledger.settle(old, { outcome: "failed", evidence: "Stale" }))).toMatchObject({
      code: "stale_attempt",
    })
    expect((yield* ledger.live()).map((x) => x.id)).toEqual([old.id])
    expect((yield* ledger.list(b))[0]?.status).toBe("completed")
  }),
)

it.live("startup preserves a live host and frees only dead read-only attempts without replay", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const dead = yield* ledger.admit({ ownerSessionID: a, dispatchKey: "dead", brief })
    yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "dead" })
    const live = yield* ledger.admit({ ownerSessionID: b, dispatchKey: "live", brief })
    yield* ledger.claim({ ownerSessionID: b, runtimeEpoch: "alive" })
    const runtime = yield* TaskExecution.make({
      ledger,
      invalidate: () => Effect.void,
      runtimeEpoch: "new",
      hostAlive: (epoch) => Effect.succeed(epoch === "alive"),
    })
    yield* runtime.startup()
    expect((yield* ledger.get({ ownerSessionID: a, taskID: dead.id })).status).toBe("failed")
    expect((yield* ledger.get({ ownerSessionID: b, taskID: live.id })).status).toBe("starting")
    expect((yield* ledger.live()).map((attempt) => attempt.ownerSessionID)).toEqual([b])
    expect((yield* ledger.details({ ownerSessionID: a, taskID: dead.id })).evidence).toContain("not replayed")
  }),
)

it.live("legacy recovery needs explicit stopped-host confirmation and retry creates one fresh attempt", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const task = yield* ledger.admit({ ownerSessionID: a, dispatchKey: "legacy", brief })
    const old = yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "legacy-host" })
    if (!old) return yield* Effect.die("Missing old attempt")
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "new" })
    yield* runtime.startup()
    const stopped = yield* ledger.get({ ownerSessionID: a, taskID: task.id })
    expect(
      yield* Effect.flip(runtime.retry({ ownerSessionID: a, taskID: task.id, generation: stopped.generation })),
    ).toMatchObject({ message: expect.stringContaining("Confirm") })
    const runs = { count: 0 }
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () =>
        Effect.sync(() => {
          runs.count++
          return {
            summary: "Facts",
            checks: [{ check: "Nonempty report", passed: true, evidence: "Host checked facts" }],
          }
        }),
      cleanup: () => Effect.succeed("Joined"),
    })
    yield* runtime.retry({ ownerSessionID: a, taskID: task.id, generation: stopped.generation, confirmStopped: true })
    yield* runtime.idle(a)
    const saved = yield* ledger.details({ ownerSessionID: a, taskID: task.id })
    expect(saved.task.status).toBe("completed")
    expect(saved.attempt?.workerSessionID).not.toBe(old.workerSessionID)
    expect(runs.count).toBe(1)
    expect(
      yield* Effect.exit(
        runtime.retry({ ownerSessionID: a, taskID: task.id, generation: stopped.generation, confirmStopped: true }),
      ),
    ).toMatchObject({ _tag: "Failure" })
  }),
)

it.live("recovery refuses a still-live host even when a user confirms it stopped", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const task = yield* ledger.admit({ ownerSessionID: a, dispatchKey: "live-retry", brief })
    yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "old-live" })
    yield* ledger.interruptEpoch("old-live")
    const runtime = yield* TaskExecution.make({
      ledger,
      invalidate: () => Effect.void,
      runtimeEpoch: "new",
      hostAlive: () => Effect.succeed(true),
    })
    const current = yield* ledger.get({ ownerSessionID: a, taskID: task.id })
    expect(
      yield* Effect.flip(
        runtime.retry({ ownerSessionID: a, taskID: task.id, generation: current.generation, confirmStopped: true }),
      ),
    ).toMatchObject({ message: expect.stringContaining("still running") })
    expect(yield* ledger.live()).toHaveLength(1)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("interrupted")
  }),
)

it.live("dead coding attempts retain ownership until their workspace changes are reviewed", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const task = yield* ledger.admit({
      ownerSessionID: a,
      dispatchKey: "coding-retry",
      brief: {
        ...brief,
        execution: { ...brief.execution, mode: "coding", paths: ["src"], baseRevision: "a".repeat(40) },
      },
    })
    yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "dead" })
    const runtime = yield* TaskExecution.make({
      ledger,
      invalidate: () => Effect.void,
      runtimeEpoch: "new",
      hostAlive: () => Effect.succeed(false),
    })
    yield* runtime.startup()
    const current = yield* ledger.get({ ownerSessionID: a, taskID: task.id })
    expect(current.status).toBe("interrupted")
    expect(
      yield* Effect.flip(runtime.retry({ ownerSessionID: a, taskID: task.id, generation: current.generation })),
    ).toMatchObject({ message: expect.stringContaining("Review workspace") })
    expect(yield* ledger.live()).toHaveLength(1)
    yield* runtime.retry({ ownerSessionID: a, taskID: task.id, generation: current.generation, reviewedChanges: true })
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("queued")
    expect(yield* ledger.live()).toHaveLength(0)
  }),
)

it.live("native side effects stay fenced after host exit and require review before explicit retry", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const task = yield* ledger.admit({
      ownerSessionID: a,
      dispatchKey: "native-recovery",
      brief: { ...brief, execution: { ...brief.execution, agent: "michael", mode: "native" } },
    })
    const attempt = yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "dead-native" })
    if (!attempt) return yield* Effect.die("Expected native claim")
    yield* ledger.transition(attempt, "running")
    const runtime = yield* TaskExecution.make({
      ledger,
      invalidate: () => Effect.void,
      runtimeEpoch: "new-native",
      hostAlive: () => Effect.succeed(false),
    })
    yield* runtime.startup()
    const current = yield* ledger.get({ ownerSessionID: a, taskID: task.id })
    expect(current.status).toBe("interrupted")
    expect(yield* ledger.live()).toHaveLength(1)
    expect(
      yield* Effect.exit(runtime.retry({ ownerSessionID: a, taskID: task.id, generation: current.generation })),
    ).toMatchObject({ _tag: "Failure" })
    yield* runtime.retry({ ownerSessionID: a, taskID: task.id, generation: current.generation, reviewedChanges: true })
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("queued")
  }),
)

it.live("persists exact configuration, rejects conflicting retry and creates one attempt under wake storms", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "one" })
    const task = yield* dispatch(runtime, "one")
    expect((yield* dispatch(runtime, "one")).id).toBe(task.id)
    expect(
      yield* Effect.flip(
        runtime.dispatch({
          ownerSessionID: a,
          dispatchKey: "one",
          brief: { ...brief, execution: { ...brief.execution, agent: "different" } },
        }),
      ),
    ).toMatchObject({ code: "conflict" })
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () =>
        Effect.succeed({
          summary: "Report",
          checks: [{ check: "Nonempty report", passed: true, evidence: "Text exists" }],
        }),
      cleanup: () => Effect.succeed("Stopped"),
    })
    yield* Effect.all(
      Array.from({ length: 20 }, () => runtime.wake(a)),
      { concurrency: "unbounded" },
    )
    yield* runtime.idle(a)
    expect(
      (yield* ledger.events({ ownerSessionID: a, after: 0 })).filter((event) => event.kind === "claimed"),
    ).toHaveLength(1)
  }),
)

it.live("times out live work and retains ownership on cleanup failure", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "one" })
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () => Effect.never,
      cleanup: () => Effect.fail("Unconfirmed child process"),
    })
    const task = yield* runtime.dispatch({
      ownerSessionID: a,
      dispatchKey: "timeout",
      brief: { ...brief, execution: { ...brief.execution, wallClockMs: 10 } },
    })
    yield* runtime.idle(a)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("interrupted")
    expect(yield* ledger.live()).toHaveLength(1)
    expect(yield* runtime.error(a)).toContain("Cleanup")
    expect(
      (yield* ledger.events({ ownerSessionID: a, after: 0 })).findLast((event) => event.kind === "interrupted")
        ?.evidence,
    ).toContain("Cleanup")
  }),
)

it.live("admits provider calls only for live worker ownership and leaves conversation calls untouched", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "one" })
    const worker = yield* Deferred.make<SessionID>()
    const release = yield* Deferred.make<void>()
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: (task, attempt) =>
        Deferred.succeed(worker, attempt.workerSessionID).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({ summary: "Report", checks: [] }),
        ),
      cleanup: () => Effect.succeed("Stopped"),
    })
    yield* dispatch(runtime, "guard")
    const id = yield* Deferred.await(worker)
    expect(yield* Effect.flip(runtime.assertModel(id, { id: "substitute", providerID: "test" }))).toMatchObject({
      message: "Worker model changed from the accepted selection; no automatic substitution",
    })
    expect(yield* runtime.beforeCall(a)).toBeUndefined()
    expect(yield* runtime.beforeCall(id, "v1")).toBeUndefined()
    expect(yield* runtime.beforeCall(id)).toMatchObject({ engine: "v2", maxCalls: 2 })
    yield* runtime.beforeCall(id)
    expect(yield* Effect.flip(runtime.beforeCall(id))).toMatchObject({ message: "Provider call budget exhausted" })
    yield* runtime.beforeNetwork(id)
    yield* runtime.beforeNetwork(id)
    expect(yield* Effect.flip(runtime.beforeNetwork(id))).toMatchObject({
      message: "Worker network call budget exhausted",
    })
    yield* Effect.forEach(Array.from({ length: 40 }), () => runtime.beforeTool(id))
    expect(yield* Effect.flip(runtime.beforeTool(id))).toMatchObject({ message: "Worker tool call budget exhausted" })
    yield* Deferred.succeed(release, undefined)
    yield* runtime.idle(a)
    expect(yield* Effect.flip(runtime.beforeCall(id))).toMatchObject({
      message: "Worker no longer owns live execution",
    })
  }),
)

it.live("application scope shutdown interrupts ownership rather than reporting completed work", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const app = yield* Scope.make()
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "app" }).pipe(
      Effect.provideService(Scope.Scope, app),
    )
    const started = yield* Deferred.make<void>()
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      cleanup: () => Effect.succeed("Stopped"),
    })
    const task = yield* dispatch(runtime, "one")
    yield* Deferred.await(started)
    yield* Scope.close(app, Exit.void)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("interrupted")
    expect(yield* ledger.live()).toHaveLength(1)
  }),
)

it.live("cancellation still interrupts the worker when interaction invalidation fails", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({
      ledger,
      invalidate: () => Effect.fail("Journal unavailable"),
      runtimeEpoch: "one",
    })
    const started = yield* Deferred.make<void>()
    const stopped = yield* Deferred.make<void>()
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      cleanup: () => Deferred.succeed(stopped, undefined).pipe(Effect.as("Stopped")),
    })
    const task = yield* dispatch(runtime, "one")
    yield* Deferred.await(started)
    yield* Effect.exit(runtime.cancel({ ownerSessionID: a, taskID: task.id }))
    yield* Deferred.await(stopped).pipe(Effect.timeout(1_000))
    yield* runtime.idle(a)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("cancelling")
    expect(yield* ledger.live()).toHaveLength(1)
  }),
)

it.live("retains a cancelled slot until actual cleanup and fences late completion", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "one" })
    const started = yield* Deferred.make<void>()
    const cleaning = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      cleanup: () =>
        Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as("Stopped")),
    })
    const task = yield* dispatch(runtime, "one")
    yield* Deferred.await(started)
    const cancel = yield* runtime.cancel({ ownerSessionID: a, taskID: task.id }).pipe(Effect.forkChild)
    yield* Deferred.await(cleaning)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("cancelling")
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(cancel)
    expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("cancelled")
  }),
)

it.live("bounds call failures and refuses unverified worker completion", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "one" })
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: (task, attempt, budget) =>
        task.dispatchKey === "budget"
          ? budget.call.pipe(
              Effect.andThen(budget.call),
              Effect.andThen(budget.call),
              Effect.as({ summary: "Too many", checks: [] }),
            )
          : Effect.succeed({ summary: "Worker said done", checks: [] }),
      cleanup: () => Effect.succeed("Stopped"),
    })
    yield* dispatch(runtime, "budget")
    yield* dispatch(runtime, "unverified")
    yield* runtime.idle(a)
    expect((yield* ledger.list(a)).map((x) => x.status)).toEqual(["failed", "failed"])
    expect(
      (yield* ledger.events({ ownerSessionID: a, after: 0 }))
        .filter((x) => x.kind === "settled")
        .every((x) => x.evidence?.includes("Stopped")),
    ).toBe(true)
  }),
)

it.live("prepares a late host before draining queued work after restart", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    yield* ledger.admit({ ownerSessionID: a, dispatchKey: "restart", brief })
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "new" })
    const prepared: string[] = []
    yield* runtime.attachHost("v2", (owner) =>
      Effect.gen(function* () {
        prepared.push(owner)
        yield* runtime.register({
          engine: "v2",
          directory: AbsolutePath.make("/execution"),
          run: () =>
            Effect.succeed({
              summary: "Report",
              checks: [{ check: "Nonempty report", passed: true, evidence: "Text exists" }],
            }),
          cleanup: () => Effect.succeed("Stopped"),
        })
      }),
    )
    yield* runtime.startup()
    yield* runtime.idle(a)
    expect(prepared).toEqual([a])
    expect((yield* ledger.list(a))[0]?.status).toBe("completed")
  }),
)

it.live("idle project reload replaces stale drivers without shutting down dispatch", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "reload" })
    const generations: number[] = []
    yield* runtime.attachHost("v2", () =>
      runtime.register({
        engine: "v2",
        directory: AbsolutePath.make("/execution"),
        run: () =>
          Effect.sync(() => {
            generations.push(runtime.generation())
            return { summary: "Report", checks: [{ check: "Nonempty report", passed: true, evidence: "Text exists" }] }
          }),
        cleanup: () => Effect.succeed("Stopped"),
      }),
    )
    yield* dispatch(runtime, "before-reload")
    yield* runtime.idle(a)
    yield* runtime.reload(Effect.void)
    yield* dispatch(runtime, "after-reload")
    yield* runtime.idle(a)
    expect(generations).toEqual([0, 1])
    expect((yield* ledger.list(a)).every((task) => task.status === "completed")).toBe(true)
  }),
)

it.live("project reload refuses to dispose live worker ownership and keeps dispatch usable", () =>
  Effect.gen(function* () {
    yield* setup
    const ledger = yield* TaskLedger.Service
    const runtime = yield* TaskExecution.make({ ledger, invalidate: () => Effect.void, runtimeEpoch: "busy-reload" })
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* runtime.register({
      engine: "v2",
      directory: AbsolutePath.make("/execution"),
      run: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({
            summary: "Report",
            checks: [{ check: "Nonempty report", passed: true, evidence: "Text exists" }],
          }),
        ),
      cleanup: () => Effect.succeed("Stopped"),
    })
    yield* dispatch(runtime, "held")
    yield* Deferred.await(started)
    const unrelated = { called: false }
    yield* runtime.reload(
      Effect.sync(() => {
        unrelated.called = true
      }),
      "/unrelated",
    )
    expect(unrelated.called).toBe(true)
    expect((yield* ledger.list(a))[0]?.status).toBe("running")
    const disposal = { called: false }
    const rejected = yield* runtime
      .reload(
        Effect.sync(() => {
          disposal.called = true
        }),
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(rejected)).toBe(true)
    expect(disposal.called).toBe(false)
    yield* Deferred.succeed(release, undefined)
    yield* runtime.idle(a)
    yield* dispatch(runtime, "still-usable")
    yield* runtime.idle(a)
    expect((yield* ledger.list(a)).every((task) => task.status === "completed")).toBe(true)
  }),
)
