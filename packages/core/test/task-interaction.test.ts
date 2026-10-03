import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { makeGlobalNode } from "../src/effect/app-node"
import { LayerNode } from "../src/effect/layer-node"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { TaskLedger } from "../src/task/ledger"
import { TaskInteractionStore } from "../src/task/interaction"
import { InteractionTable } from "../src/task/interaction.sql"
import { AttemptTable, TaskTable } from "../src/task/sql"
import { TaskInteraction } from "@opencode-ai/schema/task-interaction"
import { SessionID } from "@opencode-ai/schema/session-id"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const layer = (filename = ":memory:") =>
  AppNodeBuilder.build(LayerNode.group([Database.node, TaskLedger.node, TaskInteractionStore.node]), [
    [Database.node, makeGlobalNode({ service: Database.Service, layer: Database.layerFromPath(filename), deps: [] })],
  ])
const it = testEffect(layer())
const a = SessionID.make("ses_interaction_a")
const b = SessionID.make("ses_interaction_b")
const project = ProjectID.make("interaction_project")
const brief = {
  title: "Check",
  objective: "Check the project",
  scope: ["Project"],
  output: "Report",
  checks: ["Tests"],
  constraints: [],
}
const temporary = await tmpdir()
let ddl: readonly string[] = []

beforeAll(async () => {
  // Generate only this additive table into an isolated fixture, never the
  // repository's generated migration/snapshot/registry files.
  const process = Bun.spawn(
    [
      "bun",
      "drizzle-kit",
      "generate",
      "--dialect",
      "sqlite",
      "--schema",
      "./test/fixture/task-interaction-schema.ts",
      "--out",
      temporary.path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(process.stdout).text()
  const errors = await new Response(process.stderr).text()
  expect(await process.exited, output + errors).toBe(0)
  const files = await Array.fromAsync(new Bun.Glob("**/migration.sql").scan({ cwd: temporary.path }))
  expect(files).toHaveLength(1)
  ddl = (await Bun.file(`${temporary.path}/${files[0]}`).text())
    .split("--> statement-breakpoint")
    .filter((item) => item.trim())
})
afterAll(() => temporary[Symbol.asyncDispose]())

const install = Effect.gen(function* () {
  const database = yield* Database.Service
  const exists = yield* database.db.get(sql`SELECT name FROM sqlite_master WHERE name = 'task_interaction'`)
  if (!exists) yield* Effect.forEach(ddl, (statement) => database.db.run(statement))
})
const setup = Effect.gen(function* () {
  yield* install
  const database = yield* Database.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: project, worktree: AbsolutePath.make("/interaction"), sandboxes: [] })
  yield* database.db.insert(SessionTable).values(
    [a, b].map((id) => ({
      id,
      project_id: project,
      directory: "/interaction",
      slug: id,
      title: id,
      version: "test",
    })),
  )
})
const worker = Effect.fnUntraced(function* (ownerSessionID = a, dispatchKey = "one") {
  const ledger = yield* TaskLedger.Service
  yield* ledger.admit({ ownerSessionID, dispatchKey, brief })
  const attempt = yield* ledger.claim({ ownerSessionID, runtimeEpoch: "interaction-runtime" })
  if (!attempt) return yield* Effect.die("Expected a worker claim")
  yield* ledger.transition(attempt, "running")
  return attempt
})
const question = (sessionID: SessionID, id = "que_original", generation = 1): TaskInteraction.Open => ({
  kind: "question",
  format: "current",
  generation,
  timeCreated: 10,
  payload: {
    id,
    sessionID,
    questions: [{ header: "Plan", question: "Choose?", options: [{ label: "A", description: "First" }], custom: true }],
    tool: { messageID: "msg_native", callID: "call_native" },
    extra: { nested: [null, true, 42] },
  },
})
const permission = (sessionID: SessionID, expiresAt = Date.now() + 300_000): TaskInteraction.Open => ({
  kind: "permission",
  format: "v1",
  generation: 1,
  timeCreated: 10,
  expiresAt,
  payload: {
    id: "per_original",
    sessionID,
    permission: "bash",
    patterns: ["git status"],
    always: ["git *"],
    metadata: { command: "git status", nested: [true, null] },
    tool: { messageID: "msg_permission", callID: "call_permission" },
  },
})
const opened = Effect.fnUntraced(function* (input: TaskInteraction.Open) {
  const store = yield* TaskInteractionStore.Service
  const result = yield* store.open(input)
  if (result._tag !== "worker") return yield* Effect.die("Expected a worker interaction")
  return result.interaction
})
const answer: TaskInteraction.Decision = { kind: "question", answers: [["A typed answer"]] }

describe("durable worker interactions", () => {
  it.live("derives ownership only from live ledger attempts and preserves native payloads", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      expect(yield* store.open(question(a))).toEqual({ _tag: "not-worker" })
      // Native nonworker hooks have no ledger generation to supply. Ownership
      // must be resolved before worker-only contract validation.
      expect(yield* store.open(question(a, "que_nonworker", 0))).toEqual({ _tag: "not-worker" })
      const attempt = yield* worker()
      const input = question(attempt.workerSessionID)
      const saved = yield* opened(input)
      expect(saved).toMatchObject({
        ownerSessionID: a,
        taskID: attempt.taskID,
        attemptID: attempt.id,
        workerSessionID: attempt.workerSessionID,
        requestID: "que_original",
        generation: 1,
        state: "pending",
        timeCreated: 10,
      })
      expect(saved.payload).toEqual(input.payload)
      expect(yield* opened(input)).toEqual(saved)
      expect(yield* Effect.flip(store.get({ ownerSessionID: b, id: saved.id }))).toMatchObject({ code: "not_found" })
      expect(yield* store.list({ ownerSessionID: b })).toEqual([])
      expect(
        yield* Effect.flip(store.open({ ...input, payload: { ...input.payload, extra: "changed" } })),
      ).toMatchObject({ code: "conflict" })
      const forged = { ...input, ownerSessionID: b }
      expect(yield* Effect.flip(store.open(forged))).toMatchObject({ code: "invalid_input" })
    }),
  )

  it.live("keeps simultaneous chat requests independent and decisions exactly idempotent", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const first = yield* worker()
      const second = yield* worker(b)
      const q = yield* opened(question(first.workerSessionID))
      const p = yield* opened(permission(second.workerSessionID))
      const decide = { ownerSessionID: a, id: q.id, generation: 1, decision: answer }
      expect(yield* Effect.flip(store.decide({ ...decide, ownerSessionID: b }))).toMatchObject({ code: "not_found" })
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => store.decide(decide)),
        { concurrency: "unbounded" },
      )
      expect(results.every((item) => item.timeDecided === results[0]?.timeDecided)).toBe(true)
      expect(results[0]).toMatchObject({ state: "decided", decision: answer })
      expect(
        yield* Effect.flip(store.decide({ ...decide, decision: { kind: "question", answers: [["Different"]] } })),
      ).toMatchObject({ code: "conflict" })
      expect((yield* store.get({ ownerSessionID: b, id: p.id })).state).toBe("pending")
      expect(
        yield* Effect.flip(store.decide({ ownerSessionID: b, id: p.id, generation: 1, decision: answer })),
      ).toMatchObject({ code: "invalid_input" })
      expect(
        yield* store.decide({
          ownerSessionID: b,
          id: p.id,
          generation: 1,
          decision: { kind: "permission", reply: "reject", message: "Use read-only", automatic: false },
        }),
      ).toMatchObject({ state: "decided" })
    }),
  )

  it.live("rejects malformed response shapes and allows native custom answers and rejection", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const attempt = yield* worker()
      const q = yield* opened(question(attempt.workerSessionID))
      expect(
        yield* Effect.flip(
          store.decide({ ownerSessionID: a, id: q.id, generation: 1, decision: { kind: "question", answers: [] } }),
        ),
      ).toMatchObject({ code: "invalid_input" })
      expect(
        yield* store.decide({ ownerSessionID: a, id: q.id, generation: 1, decision: { kind: "question-rejection" } }),
      ).toMatchObject({ decision: { kind: "question-rejection" } })
    }),
  )

  it.live("fences answers and new opens when interruption advances the task but retains the attempt slot", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const ledger = yield* TaskLedger.Service
      const attempt = yield* worker()
      const q = yield* opened(question(attempt.workerSessionID))
      expect(
        yield* Effect.flip(store.decide({ ownerSessionID: a, id: q.id, generation: 2, decision: answer })),
      ).toMatchObject({ code: "stale_generation" })
      yield* ledger.interruptEpoch("interaction-runtime")
      expect(
        yield* Effect.flip(store.decide({ ownerSessionID: a, id: q.id, generation: 1, decision: answer })),
      ).toMatchObject({ code: "stale_generation" })
      expect(yield* Effect.flip(store.open(question(attempt.workerSessionID, "que_late")))).toMatchObject({
        code: "stale_generation",
      })
      expect(yield* store.invalidate({ ownerSessionID: a, attemptID: attempt.id, reason: "Interrupted" })).toHaveLength(
        1,
      )
      expect((yield* store.get({ ownerSessionID: a, id: q.id })).state).toBe("invalidated")
    }),
  )

  it.live("expires permissions durably before rejecting a late approval without extending retries", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const attempt = yield* worker()
      const input = permission(attempt.workerSessionID, 20)
      const p = yield* opened(input)
      expect(p).toMatchObject({
        state: "expired",
        expiresAt: 20,
        decision: { kind: "permission", reply: "reject", automatic: true },
      })
      expect(
        yield* Effect.flip(
          store.decide({
            ownerSessionID: a,
            id: p.id,
            generation: 1,
            decision: { kind: "permission", reply: "always" },
          }),
        ),
      ).toMatchObject({ code: "expired" })
      expect((yield* opened(input)).timeDecided).toBe(p.timeDecided)
      expect(yield* Effect.flip(store.open({ ...input, expiresAt: Date.now() + 300_000 }))).toMatchObject({
        code: "conflict",
      })
      const database = yield* Database.Service
      const live = yield* opened({
        ...permission(attempt.workerSessionID),
        payload: { ...input.payload, id: "per_later" },
      })
      yield* database.db.update(InteractionTable).set({ expires_at: 20 }).where(eq(InteractionTable.id, live.id))
      expect(
        yield* Effect.flip(
          store.decide({
            ownerSessionID: a,
            id: live.id,
            generation: 1,
            decision: { kind: "permission", reply: "once" },
          }),
        ),
      ).toMatchObject({ code: "expired" })
      expect(
        (yield* database.db.select().from(InteractionTable).where(eq(InteractionTable.id, live.id)).get())?.state,
      ).toBe("expired")
    }),
  )

  it.live("invalidates only the owned attempt and denies its permissions without overwriting decisions", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const first = yield* worker()
      const second = yield* worker(b)
      const q = yield* opened(question(first.workerSessionID))
      const p = yield* opened(permission(first.workerSessionID))
      const other = yield* opened(question(second.workerSessionID, "que_other"))
      expect(
        yield* Effect.flip(store.invalidate({ ownerSessionID: b, attemptID: first.id, reason: "Wrong chat" })),
      ).toMatchObject({ code: "not_found" })
      expect(yield* store.invalidate({ ownerSessionID: a, attemptID: first.id, reason: "Cancelled" })).toHaveLength(2)
      expect(yield* store.invalidate({ ownerSessionID: a, attemptID: first.id, reason: "Cancelled" })).toHaveLength(0)
      expect(yield* store.get({ ownerSessionID: a, id: p.id })).toMatchObject({
        state: "invalidated",
        decision: { kind: "permission", reply: "reject" },
      })
      expect(
        yield* Effect.flip(store.decide({ ownerSessionID: a, id: q.id, generation: 1, decision: answer })),
      ).toMatchObject({ code: "invalidated" })
      expect((yield* store.get({ ownerSessionID: b, id: other.id })).state).toBe("pending")
    }),
  )

  it.live("rolls back a multi-request invalidation and failed decisions atomically", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const database = yield* Database.Service
      const attempt = yield* worker()
      const q = yield* opened(question(attempt.workerSessionID))
      const p = yield* opened(permission(attempt.workerSessionID))
      yield* database.db.run(sql`CREATE TRIGGER fail_permission_update BEFORE UPDATE ON task_interaction
      WHEN OLD.kind = 'permission' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
      const exit = yield* store
        .invalidate({ ownerSessionID: a, attemptID: attempt.id, reason: "Cancel" })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect((yield* store.list({ ownerSessionID: a })).map((item) => item.state)).toEqual(["pending", "pending"])
      expect(
        (yield* store
          .decide({ ownerSessionID: a, id: p.id, generation: 1, decision: { kind: "permission", reply: "once" } })
          .pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect((yield* store.get({ ownerSessionID: a, id: p.id })).state).toBe("pending")
      expect((yield* store.get({ ownerSessionID: a, id: q.id })).state).toBe("pending")
    }),
  )

  it.live("rejects released and cancelling worker requests rather than treating them as nonworkers", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const ledger = yield* TaskLedger.Service
      const attempt = yield* worker()
      yield* ledger.cancel({ ownerSessionID: a, taskID: attempt.taskID })
      expect(yield* Effect.flip(store.open(question(attempt.workerSessionID)))).toMatchObject({
        code: "stale_generation",
      })
      yield* ledger.settle(attempt, { outcome: "cancelled", evidence: "Cleanup complete" })
      expect(yield* Effect.flip(store.open(question(attempt.workerSessionID)))).toMatchObject({
        code: "stale_generation",
      })
    }),
  )

  it.live("validates choices against the original single-choice and custom-answer policy", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const attempt = yield* worker()
      const input = question(attempt.workerSessionID)
      const q = yield* opened({
        ...input,
        payload: {
          ...input.payload,
          questions: [
            {
              header: "Plan",
              question: "Choose?",
              options: [
                { label: "A", description: "First" },
                { label: "B", description: "Second" },
              ],
              custom: false,
              multiple: false,
            },
          ],
        },
      })
      expect(
        yield* Effect.flip(
          store.decide({
            ownerSessionID: a,
            id: q.id,
            generation: 1,
            decision: { kind: "question", answers: [["A", "B"]] },
          }),
        ),
      ).toMatchObject({ code: "invalid_input" })
      expect(
        yield* Effect.flip(
          store.decide({
            ownerSessionID: a,
            id: q.id,
            generation: 1,
            decision: { kind: "question", answers: [["Unlisted"]] },
          }),
        ),
      ).toMatchObject({ code: "invalid_input" })
      expect(
        yield* store.decide({
          ownerSessionID: a,
          id: q.id,
          generation: 1,
          decision: { kind: "question", answers: [["B"]] },
        }),
      ).toMatchObject({ state: "decided" })
    }),
  )

  it.live("preserves current permission source/save and question timeout fields without projection", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const attempt = yield* worker()
      const input: TaskInteraction.Open = {
        kind: "permission",
        format: "current",
        generation: 1,
        timeCreated: 25,
        expiresAt: Date.now() + 300_000,
        payload: {
          id: "per_current",
          sessionID: attempt.workerSessionID,
          action: "bash",
          resources: ["git status"],
          save: ["git *"],
          metadata: { future: { keep: [null, true] } },
          source: { type: "tool", messageID: "msg_current", callID: "call_current" },
          extension: "retained",
        },
      }
      const p = yield* opened(input)
      expect(p.payload).toEqual(input.payload)
      const expiry = Date.now() + 100_000
      const source = question(attempt.workerSessionID, "que_v1")
      const q = yield* opened({
        ...source,
        format: "v1",
        expiresAt: expiry,
        payload: { ...source.payload, expiresAt: expiry, timeoutSeconds: 100 },
      })
      expect(q.payload).toMatchObject({
        expiresAt: expiry,
        timeoutSeconds: 100,
        tool: { messageID: "msg_native", callID: "call_native" },
      })
      expect(
        yield* Effect.flip(
          store.open({ ...source, expiresAt: expiry, payload: { ...source.payload, expiresAt: expiry + 1 } }),
        ),
      ).toMatchObject({ code: "invalid_input" })
      expect(
        yield* store.decide({
          ownerSessionID: a,
          id: p.id,
          generation: 1,
          decision: { kind: "permission", reply: "always", automatic: false },
        }),
      ).toMatchObject({ state: "decided" })
    }),
  )

  it.live("serializes contradictory answers and simultaneous requests from one worker", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const attempt = yield* worker()
      const requests = yield* Effect.all(
        Array.from({ length: 5 }, (_, i) => opened(question(attempt.workerSessionID, `que_parallel_${i}`))),
        { concurrency: "unbounded" },
      )
      expect(new Set(requests.map((row) => row.id)).size).toBe(5)
      const q = requests[0]
      if (!q) return yield* Effect.die("Expected request")
      const outcomes = yield* Effect.all(
        ["A", "B"].map((value) =>
          store
            .decide({ ownerSessionID: a, id: q.id, generation: 1, decision: { kind: "question", answers: [[value]] } })
            .pipe(Effect.result),
        ),
        { concurrency: "unbounded" },
      )
      expect(outcomes.filter((item) => item._tag === "Success")).toHaveLength(1)
      expect(outcomes.filter((item) => item._tag === "Failure")).toHaveLength(1)
      expect((yield* store.list({ ownerSessionID: a })).filter((row) => row.state === "pending")).toHaveLength(4)
    }),
  )

  it.live("keeps identical decisions fenced after interruption and historical slot release", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const ledger = yield* TaskLedger.Service
      const attempt = yield* worker()
      const q = yield* opened(question(attempt.workerSessionID))
      const input = { ownerSessionID: a, id: q.id, generation: 1, decision: answer }
      yield* store.decide(input)
      yield* ledger.interruptEpoch("interaction-runtime")
      expect(yield* Effect.flip(store.decide(input))).toMatchObject({ code: "stale_generation" })
      const database = yield* Database.Service
      expect(
        (yield* database.db.select().from(AttemptTable).where(eq(AttemptTable.id, attempt.id)).get())?.generation,
      ).toBe(1)
      expect(
        (yield* database.db.select().from(TaskTable).where(eq(TaskTable.id, attempt.taskID)).get())?.generation,
      ).toBe(2)
      expect(yield* store.invalidate({ ownerSessionID: a, attemptID: attempt.id, reason: "Interrupted" })).toEqual([])
      expect((yield* store.get({ ownerSessionID: a, id: q.id })).decision).toEqual(answer)
    }),
  )

  it.live("reads persist expiry denial and never assume an ordinary question answer", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const database = yield* Database.Service
      const attempt = yield* worker()
      const p = yield* opened(permission(attempt.workerSessionID))
      yield* database.db.update(InteractionTable).set({ expires_at: 20 }).where(eq(InteractionTable.id, p.id))
      expect((yield* store.list({ ownerSessionID: a }))[0]).toMatchObject({
        state: "expired",
        decision: { kind: "permission", reply: "reject" },
      })
      const q = yield* opened({ ...question(attempt.workerSessionID), expiresAt: 20 })
      expect(q).toMatchObject({ state: "expired" })
      expect(q.decision).toBeUndefined()
      expect(
        (yield* database.db.select().from(InteractionTable).where(eq(InteractionTable.id, p.id)).get())?.state,
      ).toBe("expired")
    }),
  )

  it.live("does not confuse JSON arrays with numeric-key objects during retry reconciliation", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* TaskInteractionStore.Service
      const attempt = yield* worker()
      const input = question(attempt.workerSessionID)
      yield* opened({ ...input, payload: { ...input.payload, extra: ["value"] } })
      expect(
        yield* Effect.flip(store.open({ ...input, payload: { ...input.payload, extra: { "0": "value" } } })),
      ).toMatchObject({ code: "conflict" })
    }),
  )

  test("reopens pending questions and final permission denials without a deferred continuation", async () => {
    await using temporary = await tmpdir()
    const run = <A, E>(
      effect: Effect.Effect<A, E, Database.Service | TaskLedger.Service | TaskInteractionStore.Service>,
    ) => Effect.runPromise(effect.pipe(Effect.provide(layer(`${temporary.path}/interactions.sqlite`)), Effect.scoped))
    const saved = await run(
      Effect.gen(function* () {
        yield* setup
        const attempt = yield* worker()
        return {
          q: yield* opened(question(attempt.workerSessionID)),
          p: yield* opened(permission(attempt.workerSessionID, 20)),
        }
      }),
    )
    await run(
      Effect.gen(function* () {
        const store = yield* TaskInteractionStore.Service
        expect(yield* store.get({ ownerSessionID: a, id: saved.q.id })).toEqual(saved.q)
        expect(yield* store.get({ ownerSessionID: a, id: saved.p.id })).toEqual(saved.p)
        expect(
          yield* store.decide({ ownerSessionID: a, id: saved.q.id, generation: 1, decision: answer }),
        ).toMatchObject({ state: "decided" })
      }),
    )
    await run(
      Effect.gen(function* () {
        const store = yield* TaskInteractionStore.Service
        expect(yield* store.get({ ownerSessionID: a, id: saved.q.id })).toMatchObject({ decision: answer })
        expect((yield* store.get({ ownerSessionID: a, id: saved.p.id })).state).toBe("expired")
      }),
    )
  })
})
