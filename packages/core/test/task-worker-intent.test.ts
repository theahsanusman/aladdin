import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { SessionProjector } from "../src/session/projector"
import { SessionStore } from "../src/session/store"
import { TaskWorkerIntent } from "../src/task/worker-intent"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { TaskLedger } from "../src/task/ledger"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { SessionID } from "@opencode-ai/schema/session-id"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { SessionInput } from "../src/session/input"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, TaskLedger.node]),
  ),
)
it.live("reconciles predetermined worker and prompt identities without duplicate creation or admission", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const ledger = yield* TaskLedger.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const owner = SessionID.make("ses_intent_root")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: ProjectID.make("intent"), worktree: AbsolutePath.make("/intent"), sandboxes: [] })
    yield* database.db.insert(SessionTable).values({
      id: owner,
      project_id: ProjectID.make("intent"),
      directory: "/intent",
      slug: "root",
      title: "Root",
      version: "test",
    })
    const task = yield* ledger.admit({
      ownerSessionID: owner,
      dispatchKey: "one",
      brief: {
        title: "Report",
        objective: "Explain facts",
        scope: ["Facts"],
        output: "Report",
        checks: ["Nonempty"],
        constraints: [],
        execution: {
          engine: "v2",
          mode: "report",
          agent: "worker",
          model: { id: "test", providerID: "test" },
          maxCalls: 2,
          wallClockMs: 1000,
        },
      },
    })
    const attempt = yield* ledger.claim({ ownerSessionID: owner, runtimeEpoch: "test" })
    if (!attempt) return yield* Effect.die("Expected claim")
    const ops = { database, events, store }
    yield* Effect.all([TaskWorkerIntent.create(ops, task, attempt), TaskWorkerIntent.create(ops, task, attempt)], {
      concurrency: "unbounded",
    })
    const input = yield* TaskWorkerIntent.admit(ops, task, attempt)
    expect((yield* TaskWorkerIntent.admit(ops, task, attempt)).id).toBe(input.id)
    expect((yield* store.get(attempt.workerSessionID))?.parentID).toBe(owner)
    expect((yield* SessionInput.find(database.db, attempt.inputMessageID))?.sessionID).toBe(attempt.workerSessionID)
    expect(yield* database.db.select().from(SessionTable).all()).toHaveLength(2)
    expect(
      yield* Effect.exit(
        TaskWorkerIntent.create(ops, { ...task, ownerSessionID: SessionID.make("ses_wrong") }, attempt),
      ),
    ).toMatchObject({ _tag: "Failure" })
    const permissions = [
      { permission: "bash", pattern: "*", action: "deny" as const },
      { permission: "chrome-devtools_*", pattern: "*", action: "allow" as const },
    ]
    yield* database.db.update(SessionTable).set({ permission: permissions }).where(eq(SessionTable.id, owner))
    const native = yield* ledger.admit({
      ownerSessionID: owner,
      dispatchKey: "native",
      brief: {
        ...task.brief,
        execution: { ...task.brief.execution!, agent: "michael", mode: "native" },
      },
    })
    const nativeAttempt = yield* ledger.claim({ ownerSessionID: owner, runtimeEpoch: "test" })
    if (!nativeAttempt) return yield* Effect.die("Expected native claim")
    yield* TaskWorkerIntent.create(ops, native, nativeAttempt)
    const nativeWorker = yield* database.db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, nativeAttempt.workerSessionID))
      .get()
    expect(nativeWorker?.permission).toEqual([
      ...permissions,
      ...["task", "task_dispatch", "plan_enter", "plan_exit"].map((permission) => ({
        permission,
        pattern: "*",
        action: "deny" as const,
      })),
    ])
  }),
)
