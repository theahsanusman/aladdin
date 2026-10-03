import { describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Cause, Effect, Schema } from "effect"
import { SqlError } from "effect/unstable/sql/SqlError"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { SessionID } from "@opencode-ai/schema/session-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { EventV2 } from "@opencode-ai/core/event"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const layer = (filename = ":memory:") =>
  AppNodeBuilder.build(LayerNode.group([Database.node, TaskLedger.node, EventV2.node]), [
    [Database.node, makeGlobalNode({ service: Database.Service, layer: Database.layerFromPath(filename), deps: [] })],
  ])
const it = testEffect(layer())
const a = SessionID.make("ses_ledger_a")
const b = SessionID.make("ses_ledger_b")
const c = SessionID.make("ses_ledger_c")
const child = SessionID.make("ses_ledger_child")
const brief = {
  title: "Verify the project",
  objective: "Run the project checks and record the results",
  scope: ["The owning project only"],
  output: "A report with verification evidence",
  checks: ["The targeted test suite passes"],
  constraints: ["Do not deploy or push"],
}
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values([
    { id: ProjectID.make("company_a"), worktree: AbsolutePath.make("/company-a"), sandboxes: [] },
    { id: ProjectID.make("company_b"), worktree: AbsolutePath.make("/company-b"), sandboxes: [] },
  ])
  yield* database.db.insert(SessionTable).values([
    { id: a, project_id: ProjectID.make("company_a"), directory: "/company-a", slug: "a", title: "A", version: "test" },
    { id: b, project_id: ProjectID.make("company_b"), directory: "/company-b", slug: "b", title: "B", version: "test" },
    { id: c, project_id: ProjectID.make("company_a"), directory: "/company-a", slug: "c", title: "C", version: "test" },
    {
      id: child,
      parent_id: a,
      project_id: ProjectID.make("company_a"),
      directory: "/company-a",
      slug: "child",
      title: "Child",
      version: "test",
    },
  ])
})

const admit = (ledger: TaskLedger.Interface, ownerSessionID = a, dispatchKey = "one") =>
  ledger.admit({ ownerSessionID, dispatchKey, brief })

const claimed = Effect.fnUntraced(function* (ledger: TaskLedger.Interface, ownerSessionID = a) {
  const attempt = yield* ledger.claim({ ownerSessionID, runtimeEpoch: "process-one" })
  if (!attempt) return yield* Effect.die("Expected a task claim")
  return attempt
})

describe("TaskLedger storage", () => {
  it.live("installs durable task, attempt, and transition storage", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      expect(
        yield* database.db.all(sql`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name IN ('task_ledger', 'task_attempt', 'task_ledger_event')
          ORDER BY name
        `),
      ).toEqual([{ name: "task_attempt" }, { name: "task_ledger" }, { name: "task_ledger_event" }])
    }),
  )
})

describe("TaskLedger", () => {
  it.live("publishes committed changes without notifying on reads or duplicating durable history", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const events = yield* EventV2.Service
      const observed: string[] = []
      const off = yield* events.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== "task.changed" && event.type !== "task.team.changed") return
          observed.push(event.type)
          if (event.type === "task.changed") {
            const input = Schema.decodeUnknownSync(Schema.Struct({ sessionID: SessionID, taskID: TaskLedger.Task.ID }))(
              event.data,
            )
            expect(yield* ledger.get({ ownerSessionID: input.sessionID, taskID: input.taskID })).toBeDefined()
          }
        }).pipe(Effect.orDie),
      )
      yield* Effect.addFinalizer(() => off)
      const task = yield* admit(ledger)
      expect(observed).toEqual(["task.changed"])
      yield* ledger.team(a)
      yield* ledger.list(a)
      yield* ledger.details({ ownerSessionID: a, taskID: task.id })
      expect(observed).toEqual(["task.changed"])
      yield* ledger.setPaused(a, true)
      expect(observed).toEqual(["task.changed", "task.team.changed"])
      expect(yield* ledger.events({ ownerSessionID: a, after: 0 })).toHaveLength(1)
    }),
  )
  it.live("persists per-chat pause without affecting running workers or other chats", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      yield* admit(ledger, a, "first")
      yield* admit(ledger, a, "second")
      yield* admit(ledger, b, "other")
      const attempt = yield* claimed(ledger)
      yield* ledger.transition(attempt, "running")
      expect(yield* ledger.setPaused(a, true)).toMatchObject({ ownerSessionID: a, paused: true })
      expect(yield* ledger.team(a)).toMatchObject({ paused: true })
      expect(yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "pause-test" })).toBeUndefined()
      expect(yield* ledger.peek(a)).toBeUndefined()
      expect((yield* ledger.get({ ownerSessionID: a, taskID: attempt.taskID })).status).toBe("running")
      expect(yield* ledger.claim({ ownerSessionID: b, runtimeEpoch: "pause-test" })).toBeDefined()
      yield* ledger.setPaused(a, false)
      expect(yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "pause-test" })).toBeDefined()
    }),
  )
  it.live("deduplicates exact concurrent admission but rejects conflicting key reuse", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const tasks = yield* Effect.all(
        Array.from({ length: 12 }, () => admit(ledger)),
        { concurrency: "unbounded" },
      )
      expect(new Set(tasks.map((task) => task.id)).size).toBe(1)
      expect(yield* ledger.list(a)).toHaveLength(1)
      expect(yield* ledger.events({ ownerSessionID: a, after: 0 })).toHaveLength(1)
      expect(
        yield* Effect.flip(
          ledger.admit({ ownerSessionID: a, dispatchKey: "one", brief: { ...brief, objective: "Different work" } }),
        ),
      ).toMatchObject({ code: "conflict" })
      expect((yield* admit(ledger, b)).id).not.toBe(tasks[0]?.id)
      expect((yield* admit(ledger, a, "two")).id).not.toBe(tasks[0]?.id)
    }),
  )

  it.live("derives placement from the root chat and rejects child, missing, and empty-directory owners", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      expect(yield* admit(ledger)).toMatchObject({
        ownerSessionID: a,
        projectID: "company_a",
        location: { directory: "/company-a" },
        status: "queued",
        generation: 0,
      })
      expect(yield* Effect.flip(admit(ledger, child))).toMatchObject({ code: "invalid_owner" })
      expect(yield* Effect.flip(admit(ledger, SessionID.make("ses_missing")))).toMatchObject({ code: "invalid_owner" })
      const database = yield* Database.Service
      yield* database.db.update(SessionTable).set({ directory: "" }).where(eq(SessionTable.id, b))
      expect(yield* Effect.flip(admit(ledger, b))).toMatchObject({ code: "invalid_owner" })
    }),
  )

  it.live("rejects malformed or unbounded briefs without admitting a task", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      expect(yield* Effect.flip(ledger.admit({ ownerSessionID: a, dispatchKey: " ", brief }))).toMatchObject({
        code: "invalid_input",
      })
      expect(
        yield* Effect.flip(
          ledger.admit({ ownerSessionID: a, dispatchKey: "empty", brief: { ...brief, objective: "" } }),
        ),
      ).toMatchObject({ code: "invalid_input" })
      expect(
        yield* Effect.flip(
          ledger.admit({ ownerSessionID: a, dispatchKey: "large", brief: { ...brief, objective: "x".repeat(20_001) } }),
        ),
      ).toMatchObject({ code: "invalid_input" })
      expect(yield* ledger.list(a)).toEqual([])
    }),
  )

  it.live("rejects unsupported dispatch fields rather than silently losing execution choices", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const input = { ownerSessionID: a, dispatchKey: "unsupported", brief, model: "not-yet-supported" }
      expect(yield* Effect.flip(ledger.admit(input))).toMatchObject({ code: "invalid_input" })
      expect(yield* ledger.list(a)).toEqual([])
    }),
  )

  it.live("isolates reads, transitions, cancellation, and event replay by owning chat", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const task = yield* admit(ledger)
      const attempt = yield* claimed(ledger)
      expect(yield* ledger.list(b)).toEqual([])
      expect(yield* ledger.events({ ownerSessionID: b, after: 0 })).toEqual([])
      expect(yield* Effect.flip(ledger.get({ ownerSessionID: b, taskID: task.id }))).toMatchObject({
        code: "not_found",
      })
      expect(yield* Effect.flip(ledger.cancel({ ownerSessionID: b, taskID: task.id }))).toMatchObject({
        code: "not_found",
      })
      expect(yield* Effect.flip(ledger.transition({ ...attempt, ownerSessionID: b }, "running"))).toMatchObject({
        code: "stale_attempt",
      })
      expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).status).toBe("starting")
    }),
  )

  it.live("atomically assigns exactly three slots to each chat with FIFO selection", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const tasks = yield* Effect.forEach([a, b, c], (ownerSessionID) =>
        Effect.forEach(["1", "2", "3", "4", "5"], (key) => admit(ledger, ownerSessionID, key)),
      )
      const attempts = yield* Effect.all(
        [a, b, c].flatMap((ownerSessionID) =>
          Array.from({ length: 8 }, () => ledger.claim({ ownerSessionID, runtimeEpoch: "process-one" })),
        ),
        { concurrency: "unbounded" },
      )
      expect(attempts.filter((attempt) => attempt !== undefined)).toHaveLength(9)
      for (const [index, owner] of [a, b, c].entries()) {
        const assigned = attempts.filter((attempt) => attempt?.ownerSessionID === owner)
        expect(assigned.map((attempt) => attempt?.slot).sort()).toEqual([1, 2, 3])
        expect(assigned.map((attempt) => attempt?.taskID)).toEqual(tasks[index]?.slice(0, 3).map((task) => task.id))
        expect((yield* ledger.list(owner)).filter((task) => task.status === "queued")).toHaveLength(2)
      }
    }),
  )

  it.live("keeps waiting, verifying, and cancelling workers counted until explicit settlement", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      yield* Effect.forEach(["1", "2", "3", "4"], (key) => admit(ledger, a, key))
      const first = yield* claimed(ledger)
      const second = yield* claimed(ledger)
      const third = yield* claimed(ledger)
      yield* ledger.transition(first, "running")
      yield* ledger.transition(first, "waiting_for_user")
      yield* ledger.transition(second, "running")
      yield* ledger.transition(second, "verifying")
      yield* ledger.cancel({ ownerSessionID: a, taskID: third.taskID })
      expect(yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "process-one" })).toBeUndefined()
      yield* ledger.settle(third, {
        outcome: "cancelled",
        evidence: "Worker process stopped and workspace cleanup finished",
      })
      expect((yield* claimed(ledger)).slot).toBe(third.slot)
      expect((yield* ledger.get({ ownerSessionID: a, taskID: first.taskID })).status).toBe("waiting_for_user")
    }),
  )

  it.live("requires verification and evidence, fencing wrong epochs and generations", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const task = yield* admit(ledger)
      const attempt = yield* claimed(ledger)
      expect(
        yield* Effect.flip(ledger.transition({ ...attempt, generation: attempt.generation + 1 }, "running")),
      ).toMatchObject({ code: "stale_attempt" })
      expect(
        yield* Effect.flip(ledger.transition({ ...attempt, runtimeEpoch: "other-process" }, "running")),
      ).toMatchObject({ code: "stale_attempt" })
      expect(yield* Effect.flip(ledger.transition(attempt, "verifying"))).toMatchObject({ code: "invalid_transition" })
      yield* ledger.transition(attempt, "running")
      expect(
        yield* Effect.flip(ledger.settle(attempt, { outcome: "completed", evidence: "A worker said done" })),
      ).toMatchObject({ code: "invalid_transition" })
      yield* ledger.transition(attempt, "verifying")
      expect(yield* Effect.flip(ledger.settle(attempt, { outcome: "completed", evidence: " " }))).toMatchObject({
        code: "invalid_input",
      })
      const result = yield* ledger.settle(attempt, {
        outcome: "completed",
        evidence: "bun test: 12 passed; integration verified",
      })
      expect(result).toMatchObject({ id: task.id, status: "completed" })
      expect(
        yield* ledger.settle(attempt, { outcome: "completed", evidence: "bun test: 12 passed; integration verified" }),
      ).toEqual(result)
      expect(
        yield* Effect.flip(ledger.settle(attempt, { outcome: "failed", evidence: "Conflicting settlement" })),
      ).toMatchObject({ code: "conflict" })
      expect((yield* ledger.events({ ownerSessionID: a, after: 0 })).map((event) => event.kind)).toEqual([
        "admitted",
        "claimed",
        "transitioned",
        "transitioned",
        "settled",
      ])
    }),
  )

  it.live("cancels queued work immediately and rejects late completion of cancelling work", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const queued = yield* admit(ledger)
      expect(yield* ledger.cancel({ ownerSessionID: a, taskID: queued.id })).toMatchObject({ status: "cancelled" })
      expect(yield* ledger.cancel({ ownerSessionID: a, taskID: queued.id })).toMatchObject({ status: "cancelled" })
      expect(yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "process-one" })).toBeUndefined()
      yield* admit(ledger, a, "active")
      const attempt = yield* claimed(ledger)
      yield* ledger.transition(attempt, "running")
      yield* ledger.transition(attempt, "verifying")
      yield* ledger.cancel({ ownerSessionID: a, taskID: attempt.taskID })
      expect(
        yield* Effect.flip(ledger.settle(attempt, { outcome: "completed", evidence: "Late verification result" })),
      ).toMatchObject({ code: "invalid_transition" })
      expect(yield* Effect.flip(ledger.transition(attempt, "running"))).toMatchObject({ code: "invalid_transition" })
      expect((yield* ledger.get({ ownerSessionID: a, taskID: attempt.taskID })).status).toBe("cancelling")
    }),
  )

  it.live("rejects project rebinding and root deletion while ledger records exist", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      yield* admit(ledger)
      const database = yield* Database.Service
      expect(yield* Effect.exit(database.db.delete(SessionTable).where(eq(SessionTable.id, a)))).toMatchObject({
        _tag: "Failure",
      })
      yield* database.db.update(SessionTable).set({ directory: "/other-project" }).where(eq(SessionTable.id, a))
      expect(yield* Effect.flip(admit(ledger, a, "new"))).toMatchObject({ code: "placement_changed" })
      expect(yield* Effect.flip(ledger.claim({ ownerSessionID: a, runtimeEpoch: "process-one" }))).toMatchObject({
        code: "placement_changed",
      })
    }),
  )

  it.live("marks lost execution interrupted without freeing slots or replaying work", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      yield* Effect.forEach(["1", "2", "3", "4"], (key) => admit(ledger, a, key))
      yield* admit(ledger, b)
      const attempts = yield* Effect.forEach([1, 2, 3], () => claimed(ledger))
      yield* ledger.claim({ ownerSessionID: b, runtimeEpoch: "other-process" })
      expect(yield* ledger.interruptEpoch("process-one")).toHaveLength(3)
      expect(yield* ledger.interruptEpoch("process-one")).toEqual([])
      expect(yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "new-process" })).toBeUndefined()
      expect((yield* ledger.list(b))[0]?.status).toBe("starting")
      const attempt = attempts[0]
      if (!attempt) return yield* Effect.die("Expected interrupted attempt")
      expect(yield* Effect.flip(ledger.transition(attempt, "running"))).toMatchObject({ code: "stale_attempt" })
      expect(
        yield* Effect.flip(
          ledger.settle(attempt, { outcome: "failed", evidence: "Old executor tried to release its slot" }),
        ),
      ).toMatchObject({ code: "stale_attempt" })
      const interrupted = yield* ledger.get({ ownerSessionID: a, taskID: attempt.taskID })
      expect(interrupted.generation).toBe(2)
      yield* ledger.reconcile({
        ownerSessionID: a,
        taskID: attempt.taskID,
        generation: interrupted.generation,
        evidence: "Confirmed old process terminated; workspace inspected; no automatic replay",
      })
      yield* ledger.retry({ ownerSessionID: a, taskID: attempt.taskID, generation: interrupted.generation })
      const next = yield* claimed(ledger)
      expect(next.taskID).not.toBe(attempt.taskID)
      yield* ledger.settle(next, { outcome: "failed", evidence: "No worker started; safe release" })
      const retried = yield* claimed(ledger)
      expect(retried).toMatchObject({ taskID: attempt.taskID, generation: 3 })
      expect(retried.workerSessionID).not.toBe(attempt.workerSessionID)
      expect(
        yield* Effect.flip(ledger.settle(attempt, { outcome: "failed", evidence: "Old settlement" })),
      ).toMatchObject({ code: "stale_attempt" })
    }),
  )

  it.live("preserves cancellation during interruption and replays only events after the cursor", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      yield* admit(ledger)
      const attempt = yield* claimed(ledger)
      yield* ledger.cancel({ ownerSessionID: a, taskID: attempt.taskID })
      const before = yield* ledger.events({ ownerSessionID: a, after: 0 })
      yield* ledger.interruptEpoch("process-one")
      expect((yield* ledger.get({ ownerSessionID: a, taskID: attempt.taskID })).status).toBe("cancelling")
      const after = yield* ledger.events({ ownerSessionID: a, after: before.at(-1)?.seq ?? 0 })
      expect(after.map((event) => event.kind)).toEqual(["interrupted"])
      expect(
        yield* Effect.flip(ledger.settle(attempt, { outcome: "cancelled", evidence: "Stale cleanup acknowledgement" })),
      ).toMatchObject({ code: "stale_attempt" })
      const interrupted = yield* ledger.get({ ownerSessionID: a, taskID: attempt.taskID })
      yield* ledger.reconcile({
        ownerSessionID: a,
        taskID: attempt.taskID,
        generation: interrupted.generation,
        evidence: "Restart cleanup confirmed",
      })
      expect(yield* ledger.interruptEpoch("process-one")).toEqual([])
    }),
  )

  it.live("rolls back the claim and slot when its durable transition cannot be recorded", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const database = yield* Database.Service
      const task = yield* admit(ledger)
      yield* database.db.run(sql`
        CREATE TEMP TRIGGER reject_task_claim BEFORE INSERT ON task_ledger_event
        WHEN NEW.kind = 'claimed' BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END
      `)
      expect(yield* Effect.exit(ledger.claim({ ownerSessionID: a, runtimeEpoch: "process-one" }))).toMatchObject({
        _tag: "Failure",
      })
      expect(yield* database.db.get(sql`SELECT COUNT(*) AS count FROM task_attempt`)).toEqual({ count: 0 })
      expect(yield* ledger.get({ ownerSessionID: a, taskID: task.id })).toMatchObject({
        status: "queued",
        generation: 0,
      })
      expect((yield* ledger.events({ ownerSessionID: a, after: 0 })).map((event) => event.kind)).toEqual(["admitted"])
      yield* database.db.run(sql`DROP TRIGGER reject_task_claim`)
      expect(yield* claimed(ledger)).toMatchObject({ taskID: task.id, generation: 1, slot: 1 })
    }),
  )

  it.live("enforces slot range, unique live ownership, and chat ownership in SQLite itself", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const database = yield* Database.Service
      const first = yield* admit(ledger)
      const second = yield* admit(ledger, a, "second")
      yield* claimed(ledger)
      const insert = (slot: number, ownerSessionID = a, taskID = second.id, generation = 1) =>
        database.db.run(sql`
        INSERT INTO task_attempt
          (id, task_id, owner_session_id, worker_session_id, input_message_id, runtime_epoch,
           generation, slot, status, time_created, time_updated)
        VALUES
          (${TaskLedger.Task.AttemptID.create()}, ${taskID}, ${ownerSessionID}, ${SessionID.create()},
           ${`msg_raw_${slot}_${generation}_${ownerSessionID}`}, 'raw-writer', ${generation}, ${slot}, 'starting', 1, 1)
      `)
      const rejected = Effect.fnUntraced(function* (
        slot: number,
        ownerSessionID = a,
        taskID = second.id,
        generation = 1,
      ) {
        const failure = yield* Effect.flip(insert(slot, ownerSessionID, taskID, generation))
        if (!Cause.isCause(failure.cause)) return yield* Effect.die("Expected Drizzle's SQL failure cause")
        const error = Cause.findErrorOption(failure.cause)
        if (error._tag !== "Some" || !(error.value instanceof SqlError))
          return yield* Effect.die("Expected an underlying SQLite constraint error")
        return String(error.value.reason.cause)
      })
      expect(yield* rejected(4)).toContain("task_attempt_slot_check")
      expect(yield* rejected(1)).toContain("task_attempt.owner_session_id, task_attempt.slot")
      expect(yield* rejected(1, b)).toContain("FOREIGN KEY constraint failed")
      expect(yield* rejected(2, a, first.id, 2)).toContain("task_attempt.task_id")
      expect(yield* database.db.get(sql`SELECT COUNT(*) AS count FROM task_attempt`)).toEqual({ count: 1 })
    }),
  )

  it.live("retains verification and slot ownership when settlement journaling fails", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const database = yield* Database.Service
      yield* admit(ledger)
      const attempt = yield* claimed(ledger)
      yield* ledger.transition(attempt, "running")
      yield* ledger.transition(attempt, "verifying")
      yield* database.db.run(sql`
        CREATE TEMP TRIGGER reject_task_settlement BEFORE INSERT ON task_ledger_event
        WHEN NEW.kind = 'settled' BEGIN SELECT RAISE(ABORT, 'injected settlement failure'); END
      `)
      expect(
        yield* Effect.exit(ledger.settle(attempt, { outcome: "completed", evidence: "Checks passed" })),
      ).toMatchObject({ _tag: "Failure" })
      expect(yield* ledger.get({ ownerSessionID: a, taskID: attempt.taskID })).toMatchObject({ status: "verifying" })
      expect(
        yield* database.db.get(sql`SELECT status, time_released FROM task_attempt WHERE id = ${attempt.id}`),
      ).toEqual({ status: "verifying", time_released: null })
      yield* database.db.run(sql`DROP TRIGGER reject_task_settlement`)
      expect(yield* ledger.settle(attempt, { outcome: "completed", evidence: "Checks passed" })).toMatchObject({
        status: "completed",
      })
    }),
  )

  it.live("rejects stale or live recovery and requires explicit, idempotent cleanup evidence", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const task = yield* admit(ledger)
      const attempt = yield* claimed(ledger)
      expect(
        yield* Effect.flip(
          ledger.reconcile({
            ownerSessionID: a,
            taskID: task.id,
            generation: 1,
            evidence: "Cannot reconcile live execution",
          }),
        ),
      ).toMatchObject({ code: "invalid_transition" })
      yield* ledger.interruptEpoch("process-one")
      expect(
        yield* Effect.flip(
          ledger.reconcile({ ownerSessionID: a, taskID: task.id, generation: 1, evidence: "Stale recovery" }),
        ),
      ).toMatchObject({ code: "stale_attempt" })
      expect(
        yield* Effect.flip(ledger.reconcile({ ownerSessionID: a, taskID: task.id, generation: 2, evidence: "" })),
      ).toMatchObject({ code: "invalid_input" })
      const input = {
        ownerSessionID: a,
        taskID: task.id,
        generation: 2,
        evidence: "Old process and children terminated; workspace inspected",
      }
      const result = yield* ledger.reconcile(input)
      expect(yield* ledger.reconcile(input)).toEqual(result)
      expect(yield* Effect.flip(ledger.reconcile({ ...input, evidence: "Different cleanup" }))).toMatchObject({
        code: "conflict",
      })
      expect(
        yield* Effect.flip(ledger.retry({ ownerSessionID: a, taskID: task.id, generation: attempt.generation })),
      ).toMatchObject({ code: "stale_attempt" })
    }),
  )

  it.live("does not duplicate large briefs in the replay journal", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const task = yield* ledger.admit({
        ownerSessionID: a,
        dispatchKey: "large-brief",
        brief: { ...brief, objective: "x".repeat(20_000) },
      })
      const attempt = yield* claimed(ledger)
      yield* ledger.transition(attempt, "running")
      expect((yield* ledger.get({ ownerSessionID: a, taskID: task.id })).brief.objective).toHaveLength(20_000)
      const events = yield* ledger.events({ ownerSessionID: a, after: 0 })
      events.forEach((event) => expect(JSON.stringify(event).length).toBeLessThan(4_000))
    }),
  )

  it.live("paginates durable tasks and events without hiding work beyond the first hundred", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      yield* Effect.forEach(
        Array.from({ length: 105 }, (_, index) => String(index)),
        (key) => admit(ledger, a, key),
      )
      const first = yield* ledger.list(a)
      expect(first).toHaveLength(100)
      const last = first.at(-1)
      if (!last) return yield* Effect.die("Expected the first task page")
      const second = yield* ledger.list(a, last.queueSequence)
      expect(second).toHaveLength(5)
      expect(new Set([...first, ...second].map((task) => task.id)).size).toBe(105)
      const events = yield* ledger.events({ ownerSessionID: a, after: 0 })
      expect(events).toHaveLength(100)
      expect(yield* ledger.events({ ownerSessionID: a, after: events.at(-1)?.seq ?? 0 })).toHaveLength(5)
      expect(yield* Effect.flip(ledger.list(a, -1))).toMatchObject({ code: "invalid_input" })
    }),
  )

  test("independent processes share exact admission and the same three-slot chat limit", async () => {
    await using tmp = await tmpdir()
    const filename = `${tmp.path}/concurrent.sqlite`
    const run = <A, E>(effect: Effect.Effect<A, E, Database.Service | TaskLedger.Service>) =>
      Effect.runPromise(effect.pipe(Effect.provide(layer(filename)), Effect.scoped))
    await run(setup)
    const workers = Array.from({ length: 6 }, (_, index) =>
      Bun.spawn(
        [
          process.execPath,
          new URL("./fixture/task-ledger-worker.ts", import.meta.url).pathname,
          filename,
          a,
          `process-${index}`,
        ],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      ),
    )
    try {
      workers.forEach((worker) => {
        worker.stdin.write("start")
        worker.stdin.end()
      })
      const results = await Promise.all(
        workers.map(async (worker) => {
          const output = await new Response(worker.stdout).text()
          const errors = await new Response(worker.stderr).text()
          expect(await worker.exited, errors).toBe(0)
          return Schema.decodeUnknownSync(
            Schema.Struct({
              taskID: TaskLedger.Task.ID,
              attempts: Schema.Array(TaskLedger.Task.Attempt),
            }),
          )(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(output))
        }),
      )
      expect(new Set(results.map((result) => result.taskID)).size).toBe(1)
      const attempts = results.flatMap((result) => result.attempts)
      expect(attempts).toHaveLength(3)
      expect(attempts.map((attempt) => attempt.slot).sort()).toEqual([1, 2, 3])
      expect(new Set(attempts.map((attempt) => attempt.id)).size).toBe(3)
      await run(
        Effect.gen(function* () {
          const ledger = yield* TaskLedger.Service
          expect(yield* ledger.list(a)).toHaveLength(7)
          expect(
            (yield* ledger.events({ ownerSessionID: a, after: 0 })).filter((event) => event.kind === "admitted"),
          ).toHaveLength(7)
        }),
      )
    } finally {
      workers.filter((worker) => worker.exitCode === null).forEach((worker) => worker.kill())
      await Promise.all(workers.map((worker) => worker.exited))
    }
  }, 30_000)

  test("retains admitted tasks and exact attempt identities after closing and reopening SQLite", async () => {
    await using tmp = await tmpdir()
    const filename = `${tmp.path}/ledger.sqlite`
    const run = <A, E>(effect: Effect.Effect<A, E, Database.Service | TaskLedger.Service>) =>
      Effect.runPromise(effect.pipe(Effect.provide(layer(filename)), Effect.scoped))
    const saved = await run(
      Effect.gen(function* () {
        yield* setup
        const ledger = yield* TaskLedger.Service
        const task = yield* admit(ledger)
        const attempt = yield* claimed(ledger)
        return { task, attempt }
      }),
    )
    await run(
      Effect.gen(function* () {
        const ledger = yield* TaskLedger.Service
        expect((yield* admit(ledger)).id).toBe(saved.task.id)
        expect((yield* ledger.events({ ownerSessionID: a, after: 0 }))[1]?.attempt).toEqual(saved.attempt)
        yield* ledger.interruptEpoch("process-one")
      }),
    )
    await run(
      Effect.gen(function* () {
        const ledger = yield* TaskLedger.Service
        expect(yield* ledger.get({ ownerSessionID: a, taskID: saved.task.id })).toMatchObject({ status: "interrupted" })
        expect(yield* ledger.claim({ ownerSessionID: a, runtimeEpoch: "new-process" })).toBeUndefined()
      }),
    )
  })

  it.live("hides deleted finished jobs from board, list, and counts while keeping their records", () =>
    Effect.gen(function* () {
      yield* setup
      const database = yield* Database.Service
      const ledger = yield* TaskLedger.Service
      const events = yield* EventV2.Service
      const task = yield* admit(ledger)
      const other = yield* admit(ledger, a, "second")
      const foreign = yield* admit(ledger, b, "other")
      expect(yield* Effect.flip(ledger.dismiss({ ownerSessionID: a, taskID: task.id }))).toMatchObject({
        code: "invalid_transition",
      })
      expect(yield* Effect.flip(ledger.dismiss({ ownerSessionID: a, taskID: foreign.id }))).toMatchObject({
        code: "not_found",
      })
      const observed: string[] = []
      const off = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "task.changed") observed.push(event.type)
        }),
      )
      yield* Effect.addFinalizer(() => off)
      yield* ledger.cancel({ ownerSessionID: a, taskID: task.id })
      expect(yield* ledger.dismiss({ ownerSessionID: a, taskID: task.id })).toMatchObject({
        id: task.id,
        status: "cancelled",
      })
      // Repeating the removal must succeed without changing anything again.
      expect(yield* ledger.dismiss({ ownerSessionID: a, taskID: task.id })).toMatchObject({ id: task.id })
      expect(observed).toEqual(["task.changed", "task.changed"])
      const board = yield* ledger.board(a)
      expect(board.data.map((item) => item.task.id)).toEqual([other.id])
      expect(board.counts).toEqual({ queued: 1 })
      expect((yield* ledger.list(a)).map((item) => item.id)).toEqual([other.id])
      expect(yield* ledger.get({ ownerSessionID: a, taskID: task.id })).toMatchObject({ status: "cancelled" })
      expect(yield* ledger.details({ ownerSessionID: a, taskID: task.id })).toMatchObject({ task: { id: task.id } })
      expect(yield* database.db.get(sql`SELECT COUNT(*) AS count FROM task_ledger`)).toEqual({ count: 3 })
    }),
  )

  it.live("returns a deleted job when its exact dispatch or settled retry comes back", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const task = yield* admit(ledger)
      const attempt = yield* claimed(ledger)
      yield* ledger.transition(attempt, "running")
      yield* ledger.settle(attempt, { outcome: "failed", evidence: "Worker failed its checks" })
      yield* ledger.dismiss({ ownerSessionID: a, taskID: task.id })
      expect((yield* ledger.board(a)).data).toEqual([])
      expect(yield* admit(ledger)).toMatchObject({ id: task.id })
      expect((yield* ledger.board(a)).data.map((item) => item.task.id)).toEqual([task.id])
      yield* ledger.dismiss({ ownerSessionID: a, taskID: task.id })
      expect((yield* ledger.board(a)).data).toEqual([])
      expect(yield* ledger.retry({ ownerSessionID: a, taskID: task.id, generation: attempt.generation })).toMatchObject(
        { id: task.id, status: "queued" },
      )
      expect((yield* ledger.board(a)).data.map((item) => item.task.id)).toEqual([task.id])
      expect((yield* ledger.details({ ownerSessionID: a, taskID: task.id })).evidence).toBe("Worker failed its checks")
    }),
  )
})
