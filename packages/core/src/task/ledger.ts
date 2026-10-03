export * as TaskLedger from "./ledger"

import { and, asc, desc, eq, gt, isNull, inArray, notInArray, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schedule, Schema } from "effect"
import { SqlError } from "effect/unstable/sql/SqlError"
import { Task } from "@opencode-ai/schema/task"
import { TaskNotice } from "@opencode-ai/schema/task-notice"
import { EventV2 } from "../event"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { AbsolutePath, NonNegativeInt } from "@opencode-ai/schema/schema"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionTable } from "../session/sql"
import { AttemptTable, TaskEventTable, TaskTable, TeamTable } from "./sql"

export { Task }

type Transaction = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]
type TaskRow = typeof TaskTable.$inferSelect
type AttemptRow = typeof AttemptTable.$inferSelect
type OwnedTask = { readonly ownerSessionID: SessionID; readonly taskID: Task.ID }
type ActiveStatus = "running" | "waiting_for_user" | "verifying"
// Settled outcomes. Only these jobs may be deleted from a chat's views.
const terminal: Task.Status[] = ["completed", "failed", "cancelled"]
// A dismissed job stays fully recorded; it is only excluded from reads.
const notDismissed = isNull(TaskTable.time_dismissed)

export class Error extends Schema.TaggedErrorClass<Error>()("TaskLedger.Error", {
  code: Schema.Literals([
    "invalid_input",
    "invalid_owner",
    "not_found",
    "conflict",
    "placement_changed",
    "stale_attempt",
    "invalid_transition",
  ]),
  message: Schema.String,
}) {}

export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@opencode/TaskLedger") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    return make(
      database.db,
      (task: Task.Info) =>
        events.publish(
          TaskNotice.Event.Changed,
          { sessionID: task.ownerSessionID, taskID: task.id },
          { location: task.location },
        ),
      (team: Task.Team) =>
        Effect.gen(function* () {
          const row = yield* database.db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.id, team.ownerSessionID))
            .get()
            .pipe(Effect.orDie)
          if (!row) return yield* Effect.die("Task team lost its root Session")
          yield* events.publish(
            TaskNotice.Event.TeamChanged,
            { sessionID: team.ownerSessionID },
            {
              location: {
                directory: AbsolutePath.make(row.directory),
                ...(row.workspace_id === null ? {} : { workspaceID: row.workspace_id }),
              },
            },
          )
        }),
    )
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node] })

function make(
  db: Database.Interface["db"],
  notify: (task: Task.Info) => Effect.Effect<void>,
  notifyTeam: (team: Task.Team) => Effect.Effect<void>,
) {
  const write = <A, E, R>(body: (tx: Transaction) => Effect.Effect<A, E, R>) =>
    db.transaction(body, { behavior: "immediate" }).pipe(
      Effect.retry({
        times: 3,
        schedule: Schedule.exponential(10),
        while: (error) => error instanceof SqlError && error.reason._tag === "LockTimeoutError",
      }),
    )

  const root = Effect.fnUntraced(function* (tx: Transaction, ownerSessionID: SessionID) {
    const row = yield* tx.select().from(SessionTable).where(eq(SessionTable.id, ownerSessionID)).get()
    if (!row || row.parent_id !== null || !row.directory) {
      return yield* Effect.fail(
        new Error({ code: "invalid_owner", message: "Tasks require an existing root chat with local placement" }),
      )
    }
    return row
  })

  const placement = Effect.fnUntraced(function* (tx: Transaction, task: TaskRow) {
    const owner = yield* root(tx, task.owner_session_id)
    if (
      owner.project_id !== task.project_id ||
      owner.directory !== task.directory ||
      owner.workspace_id !== task.workspace_id
    ) {
      return yield* Effect.fail(
        new Error({ code: "placement_changed", message: "The root chat's project placement changed; use a new chat" }),
      )
    }
  })

  const owned = Effect.fnUntraced(function* (tx: Transaction, input: OwnedTask) {
    const row = yield* tx
      .select()
      .from(TaskTable)
      .where(and(eq(TaskTable.id, input.taskID), eq(TaskTable.owner_session_id, input.ownerSessionID)))
      .get()
    if (!row) return yield* Effect.fail(new Error({ code: "not_found", message: "Task does not belong to this chat" }))
    yield* placement(tx, row)
    return row
  })

  const fenced = Effect.fnUntraced(function* (tx: Transaction, token: Task.Attempt) {
    const attempt = yield* tx.select().from(AttemptTable).where(eq(AttemptTable.id, token.id)).get()
    const task = attempt ? yield* tx.select().from(TaskTable).where(eq(TaskTable.id, attempt.task_id)).get() : undefined
    if (
      !attempt ||
      !task ||
      attempt.task_id !== token.taskID ||
      attempt.owner_session_id !== token.ownerSessionID ||
      attempt.runtime_epoch !== token.runtimeEpoch ||
      attempt.generation !== token.generation ||
      task.generation !== token.generation ||
      attempt.worker_session_id !== token.workerSessionID ||
      attempt.input_message_id !== token.inputMessageID ||
      attempt.slot !== token.slot
    ) {
      return yield* Effect.fail(
        new Error({ code: "stale_attempt", message: "Attempt identity or execution generation is no longer current" }),
      )
    }
    yield* placement(tx, task)
    return { task, attempt }
  })

  const record = (tx: Transaction, task: TaskRow, kind: Task.EventKind, attempt?: AttemptRow, evidence?: string) =>
    tx
      .insert(TaskEventTable)
      .values({
        task_id: task.id,
        owner_session_id: task.owner_session_id,
        kind,
        data: {
          task: {
            id: task.id,
            ownerSessionID: task.owner_session_id,
            status: task.status,
            generation: task.generation,
            queueSequence: task.queue_seq,
            timeUpdated: task.time_updated,
          },
          ...(attempt ? { attempt: intent(attempt) } : {}),
          ...(evidence === undefined ? {} : { evidence }),
        },
      })
      .run()

  const save = Effect.fnUntraced(function* (
    tx: Transaction,
    task: TaskRow,
    kind: Task.EventKind,
    attempt?: AttemptRow,
    evidence?: string,
  ) {
    yield* tx
      .update(TaskTable)
      .set({
        status: task.status,
        generation: task.generation,
        queue_seq: task.queue_seq,
        time_updated: task.time_updated,
        time_dismissed: task.time_dismissed,
      })
      .where(eq(TaskTable.id, task.id))
    if (attempt)
      yield* tx
        .update(AttemptTable)
        .set({
          status: attempt.status,
          evidence: attempt.evidence,
          time_updated: attempt.time_updated,
          time_interrupted: attempt.time_interrupted,
          time_released: attempt.time_released,
        })
        .where(eq(AttemptTable.id, attempt.id))
    yield* record(tx, task, kind, attempt, evidence)
    return info(task)
  })

  const queueSequence = Effect.fnUntraced(function* (tx: Transaction) {
    const row = yield* tx.get<{ seq: number }>(sql`SELECT COALESCE(MAX(queue_seq), 0) + 1 AS seq FROM task_ledger`)
    if (!row) return yield* Effect.die("Missing task queue sequence")
    return row.seq
  })

  const admit = Effect.fn("TaskLedger.admit")(function* (input: Task.Dispatch) {
    const dispatch = yield* decode(Task.Dispatch, input)
    return yield* write((tx) =>
      Effect.gen(function* () {
        const owner = yield* root(tx, dispatch.ownerSessionID)
        const previous = yield* tx
          .select()
          .from(TaskTable)
          .where(eq(TaskTable.owner_session_id, owner.id))
          .limit(1)
          .get()
        if (previous) yield* placement(tx, previous)
        const existing = yield* tx
          .select()
          .from(TaskTable)
          .where(and(eq(TaskTable.owner_session_id, owner.id), eq(TaskTable.dispatch_key, dispatch.dispatchKey)))
          .get()
        if (existing) {
          if (
            JSON.stringify(Schema.encodeSync(Task.Brief)(existing.brief)) !==
            JSON.stringify(Schema.encodeSync(Task.Brief)(dispatch.brief))
          ) {
            return yield* Effect.fail(
              new Error({ code: "conflict", message: "Dispatch key was already used for a different task brief" }),
            )
          }
          if (existing.time_dismissed === null) return info(existing)
          // Re-admitting a deleted job restores it to this chat's views.
          const restored = DateTime.toEpochMillis(yield* DateTime.now)
          yield* tx
            .update(TaskTable)
            .set({ time_dismissed: null, time_updated: restored })
            .where(eq(TaskTable.id, existing.id))
          return info({ ...existing, time_dismissed: null, time_updated: restored })
        }
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const row = yield* tx
          .insert(TaskTable)
          .values({
            id: Task.ID.create(),
            owner_session_id: owner.id,
            project_id: owner.project_id,
            directory: AbsolutePath.make(owner.directory),
            workspace_id: owner.workspace_id,
            dispatch_key: dispatch.dispatchKey,
            brief: dispatch.brief,
            status: "queued",
            generation: 0,
            queue_seq: yield* queueSequence(tx),
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
        if (!row) return yield* Effect.die("Task admission did not persist")
        yield* record(tx, row, "admitted")
        return info(row)
      }),
    )
  })

  const claim = Effect.fn("TaskLedger.claim")(function* (input: {
    readonly ownerSessionID: SessionID
    readonly runtimeEpoch: string
  }) {
    const epoch = yield* decode(Task.RuntimeEpoch, input.runtimeEpoch)
    return yield* write((tx) =>
      Effect.gen(function* () {
        yield* root(tx, input.ownerSessionID)
        const team = yield* tx
          .select()
          .from(TeamTable)
          .where(eq(TeamTable.owner_session_id, input.ownerSessionID))
          .get()
        if (team?.paused) return
        const previous = yield* tx
          .select()
          .from(TaskTable)
          .where(eq(TaskTable.owner_session_id, input.ownerSessionID))
          .limit(1)
          .get()
        if (previous) yield* placement(tx, previous)
        const occupied = yield* tx
          .select({ slot: AttemptTable.slot })
          .from(AttemptTable)
          .where(and(eq(AttemptTable.owner_session_id, input.ownerSessionID), isNull(AttemptTable.time_released)))
          .all()
        const slot = Task.Slot.literals.find((value) => !occupied.some((attempt) => attempt.slot === value))
        if (slot === undefined) return
        const task = yield* tx
          .select()
          .from(TaskTable)
          .where(and(eq(TaskTable.owner_session_id, input.ownerSessionID), eq(TaskTable.status, "queued")))
          .orderBy(asc(TaskTable.queue_seq))
          .limit(1)
          .get()
        if (!task) return
        yield* placement(tx, task)
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const attempt = yield* tx
          .insert(AttemptTable)
          .values({
            id: Task.AttemptID.create(),
            task_id: task.id,
            owner_session_id: task.owner_session_id,
            worker_session_id: SessionID.create(),
            input_message_id: SessionMessage.ID.create(),
            runtime_epoch: epoch,
            generation: task.generation + 1,
            slot,
            status: "starting",
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
        if (!attempt) return yield* Effect.die("Task claim did not persist")
        yield* save(
          tx,
          { ...task, status: "starting", generation: attempt.generation, time_updated: now },
          "claimed",
          attempt,
        )
        return intent(attempt)
      }),
    )
  })

  const transition = Effect.fn("TaskLedger.transition")(function* (token: Task.Attempt, status: ActiveStatus) {
    const checked = yield* decode(Task.Attempt, token)
    return yield* write((tx) =>
      Effect.gen(function* () {
        const current = yield* fenced(tx, checked)
        const valid =
          current.attempt.time_released === null &&
          ((status === "running" &&
            (current.task.status === "starting" || current.task.status === "waiting_for_user")) ||
            ((status === "waiting_for_user" || status === "verifying") && current.task.status === "running") ||
            (status === "waiting_for_user" && current.task.status === "verifying") ||
            (status === "verifying" && current.task.status === "waiting_for_user"))
        if (!valid)
          return yield* Effect.fail(
            new Error({ code: "invalid_transition", message: `Cannot move ${current.task.status} to ${status}` }),
          )
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        return yield* save(tx, { ...current.task, status, time_updated: now }, "transitioned", {
          ...current.attempt,
          status,
          time_updated: now,
        })
      }),
    )
  })

  const settle = Effect.fn("TaskLedger.settle")(function* (token: Task.Attempt, input: Task.Settlement) {
    const checked = yield* decode(Task.Attempt, token)
    const settlement = yield* decode(Task.Settlement, input)
    return yield* write((tx) =>
      Effect.gen(function* () {
        const current = yield* fenced(tx, checked)
        if (current.attempt.time_released !== null) {
          if (current.attempt.status === settlement.outcome && current.attempt.evidence === settlement.evidence)
            return info(current.task)
          return yield* Effect.fail(
            new Error({ code: "conflict", message: "Attempt already has a different settlement" }),
          )
        }
        const valid =
          settlement.outcome === "completed"
            ? current.task.status === "verifying"
            : settlement.outcome === "cancelled"
              ? current.task.status === "cancelling"
              : ["starting", "running", "waiting_for_user", "verifying"].includes(current.task.status)
        if (!valid)
          return yield* Effect.fail(
            new Error({
              code: "invalid_transition",
              message: `Cannot settle ${current.task.status} as ${settlement.outcome}`,
            }),
          )
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        // Cancellation settlement asserts cleanup. This ledger does not kill
        // processes or prove quiescence; interrupted tokens are always fenced.
        return yield* save(
          tx,
          { ...current.task, status: settlement.outcome, time_updated: now },
          "settled",
          {
            ...current.attempt,
            status: settlement.outcome,
            evidence: settlement.evidence,
            time_updated: now,
            time_released: now,
          },
          settlement.evidence,
        )
      }),
    )
  })

  const cancel = Effect.fn("TaskLedger.cancel")(function* (input: OwnedTask) {
    return yield* write((tx) =>
      Effect.gen(function* () {
        const task = yield* owned(tx, input)
        if (task.status === "cancelled" || task.status === "cancelling") return info(task)
        if (task.status === "completed" || task.status === "failed") {
          return yield* Effect.fail(
            new Error({ code: "invalid_transition", message: "A settled task cannot be cancelled" }),
          )
        }
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        if (task.status === "queued")
          return yield* save(tx, { ...task, status: "cancelled", time_updated: now }, "cancel_requested")
        const attempt = yield* tx
          .select()
          .from(AttemptTable)
          .where(and(eq(AttemptTable.task_id, task.id), isNull(AttemptTable.time_released)))
          .get()
        if (!attempt) return yield* Effect.die("Active task has no owned attempt")
        return yield* save(tx, { ...task, status: "cancelling", time_updated: now }, "cancel_requested", {
          ...attempt,
          status: "cancelling",
          time_updated: now,
        })
      }),
    )
  })

  // Deletion is a durable soft dismissal, not a row removal: finished work
  // leaves every board, list, and count while keeping its record, attempts,
  // evidence, child transcript, and exact dispatch-key identity. It publishes
  // the same task notice as a transition so other clients refresh their views.
  const dismiss = Effect.fn("TaskLedger.dismiss")(function* (input: OwnedTask) {
    return yield* write((tx) =>
      Effect.gen(function* () {
        const task = yield* owned(tx, input)
        if (!terminal.includes(task.status))
          return yield* Effect.fail(
            new Error({ code: "invalid_transition", message: "Only a finished worker job can be deleted" }),
          )
        if (task.time_dismissed !== null) return { task: info(task), changed: false }
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        yield* tx
          .update(TaskTable)
          .set({ time_dismissed: now, time_updated: now })
          .where(and(eq(TaskTable.id, task.id), eq(TaskTable.owner_session_id, task.owner_session_id)))
        return { task: info({ ...task, time_dismissed: now, time_updated: now }), changed: true }
      }),
    )
  })

  const retry = Effect.fn("TaskLedger.retry")(function* (input: OwnedTask & { readonly generation: number }) {
    yield* decode(Task.Generation, input.generation)
    return yield* write((tx) =>
      Effect.gen(function* () {
        const task = yield* owned(tx, input)
        if (task.generation !== input.generation)
          return yield* Effect.fail(new Error({ code: "stale_attempt", message: "Retry refers to an older attempt" }))
        if (task.status !== "failed")
          return yield* Effect.fail(
            new Error({ code: "invalid_transition", message: "Only an explicitly settled failure may be retried" }),
          )
        return yield* save(
          tx,
          {
            ...task,
            status: "queued",
            queue_seq: yield* queueSequence(tx),
            time_updated: DateTime.toEpochMillis(yield* DateTime.now),
            time_dismissed: null,
          },
          "retried",
        )
      }),
    )
  })

  const reconcile = Effect.fn("TaskLedger.reconcile")(function* (
    input: OwnedTask & { readonly generation: number; readonly evidence: string },
  ) {
    yield* decode(Task.Generation, input.generation)
    const evidence = (yield* decode(Task.Settlement, { outcome: "failed", evidence: input.evidence })).evidence
    return yield* write((tx) =>
      Effect.gen(function* () {
        const task = yield* owned(tx, input)
        if (task.generation !== input.generation)
          return yield* Effect.fail(
            new Error({ code: "stale_attempt", message: "Recovery refers to an older ownership generation" }),
          )
        const attempt = yield* tx
          .select()
          .from(AttemptTable)
          .where(eq(AttemptTable.task_id, task.id))
          .orderBy(sql`${AttemptTable.generation} DESC`)
          .limit(1)
          .get()
        if (!attempt || attempt.time_interrupted === null)
          return yield* Effect.fail(
            new Error({ code: "invalid_transition", message: "Task has no interrupted attempt to reconcile" }),
          )
        if (attempt.time_released !== null) {
          if ((task.status === "failed" || task.status === "cancelled") && attempt.evidence === evidence)
            return info(task)
          return yield* Effect.fail(
            new Error({ code: "conflict", message: "Interrupted attempt already has a different reconciliation" }),
          )
        }
        if (task.status !== "interrupted" && task.status !== "cancelling")
          return yield* Effect.fail(
            new Error({ code: "invalid_transition", message: "Task is not awaiting interruption cleanup" }),
          )
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const status = task.status === "cancelling" ? "cancelled" : "failed"
        // Only the recovery controller may call this after proving old execution
        // stopped and inspecting side effects. Recovery never schedules a retry.
        return yield* save(
          tx,
          { ...task, status, time_updated: now },
          "settled",
          {
            ...attempt,
            status,
            evidence,
            time_updated: now,
            time_released: now,
          },
          evidence,
        )
      }),
    )
  })

  const interruptEpoch = Effect.fn("TaskLedger.interruptEpoch")(function* (runtimeEpoch: string) {
    const epoch = yield* decode(Task.RuntimeEpoch, runtimeEpoch)
    return yield* write((tx) =>
      Effect.gen(function* () {
        const attempts = yield* tx
          .select()
          .from(AttemptTable)
          .where(
            and(
              eq(AttemptTable.runtime_epoch, epoch),
              isNull(AttemptTable.time_released),
              isNull(AttemptTable.time_interrupted),
            ),
          )
          .all()
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        return yield* Effect.forEach(attempts, (attempt) =>
          Effect.gen(function* () {
            const task = yield* tx.select().from(TaskTable).where(eq(TaskTable.id, attempt.task_id)).get()
            if (!task) return yield* Effect.die("Attempt lost its task owner")
            const status = task.status === "cancelling" ? "cancelling" : "interrupted"
            return yield* save(
              tx,
              { ...task, status, generation: task.generation + 1, time_updated: now },
              "interrupted",
              {
                ...attempt,
                status,
                time_updated: now,
                time_interrupted: now,
              },
            )
          }),
        )
      }),
    )
  })

  return {
    admit: (input: Task.Dispatch) => admit(input).pipe(Effect.tap(notify)),
    claim,
    transition: (token: Task.Attempt, status: ActiveStatus) => transition(token, status).pipe(Effect.tap(notify)),
    settle: (token: Task.Attempt, input: Task.Settlement) => settle(token, input).pipe(Effect.tap(notify)),
    cancel: (input: OwnedTask) => cancel(input).pipe(Effect.tap(notify)),
    dismiss: (input: OwnedTask) =>
      dismiss(input).pipe(
        Effect.tap((result) => (result.changed ? notify(result.task) : Effect.void)),
        Effect.map((result) => result.task),
      ),
    retry: (input: OwnedTask & { readonly generation: number }) => retry(input).pipe(Effect.tap(notify)),
    reconcile: (input: OwnedTask & { readonly generation: number; readonly evidence: string }) =>
      reconcile(input).pipe(Effect.tap(notify)),
    interruptEpoch: (epoch: string) =>
      interruptEpoch(epoch).pipe(Effect.tap((tasks) => Effect.forEach(tasks, notify, { discard: true }))),
    team: Effect.fn("TaskLedger.team")((ownerSessionID: SessionID) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* root(tx, ownerSessionID)
          const team = yield* tx.select().from(TeamTable).where(eq(TeamTable.owner_session_id, ownerSessionID)).get()
          return Task.Team.make({ ownerSessionID, paused: team?.paused ?? false, timeUpdated: team?.time_updated ?? 0 })
        }),
      ),
    ),
    setPaused: Effect.fn("TaskLedger.setPaused")((ownerSessionID: SessionID, paused: boolean) =>
      write((tx) =>
        Effect.gen(function* () {
          yield* root(tx, ownerSessionID)
          yield* decode(Schema.Boolean, paused)
          const timeUpdated = DateTime.toEpochMillis(yield* DateTime.now)
          yield* tx
            .insert(TeamTable)
            .values({ owner_session_id: ownerSessionID, paused, time_updated: timeUpdated })
            .onConflictDoUpdate({ target: TeamTable.owner_session_id, set: { paused, time_updated: timeUpdated } })
          return Task.Team.make({ ownerSessionID, paused, timeUpdated })
        }),
      ).pipe(Effect.tap(notifyTeam)),
    ),
    worker: Effect.fn("TaskLedger.worker")((workerSessionID: SessionID) =>
      db
        .select()
        .from(AttemptTable)
        .where(eq(AttemptTable.worker_session_id, workerSessionID))
        .get()
        .pipe(Effect.map((row) => (row ? intent(row) : undefined))),
    ),
    interruptAttempt: Effect.fn("TaskLedger.interruptAttempt")((token: Task.Attempt, evidence?: string) =>
      write((tx) =>
        Effect.gen(function* () {
          const current = yield* fenced(tx, token)
          if (evidence !== undefined) yield* decode(Task.Settlement, { outcome: "failed", evidence })
          if (current.attempt.time_released !== null || current.attempt.time_interrupted !== null)
            return info(current.task)
          const now = DateTime.toEpochMillis(yield* DateTime.now)
          const status = current.task.status === "cancelling" ? "cancelling" : "interrupted"
          return yield* save(
            tx,
            { ...current.task, status, generation: current.task.generation + 1, time_updated: now },
            "interrupted",
            {
              ...current.attempt,
              status,
              time_updated: now,
              time_interrupted: now,
              evidence: evidence ?? current.attempt.evidence,
            },
            evidence,
          )
        }),
      ),
    ),
    peek: Effect.fn("TaskLedger.peek")((ownerSessionID: SessionID) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* root(tx, ownerSessionID)
          const team = yield* tx.select().from(TeamTable).where(eq(TeamTable.owner_session_id, ownerSessionID)).get()
          if (team?.paused) return
          const task = yield* tx
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.owner_session_id, ownerSessionID), eq(TaskTable.status, "queued")))
            .orderBy(asc(TaskTable.queue_seq))
            .limit(1)
            .get()
          if (!task) return
          yield* placement(tx, task)
          return info(task)
        }),
      ),
    ),
    // Startup inspection does not release ownership or authorize replay.
    live: Effect.fn("TaskLedger.live")(function* () {
      return (yield* db.select().from(AttemptTable).where(isNull(AttemptTable.time_released)).all()).map(intent)
    }),
    readyOwners: Effect.fn("TaskLedger.readyOwners")(function* () {
      return (yield* db
        .select({ owner: TaskTable.owner_session_id })
        .from(TaskTable)
        .where(eq(TaskTable.status, "queued"))
        .groupBy(TaskTable.owner_session_id)
        .orderBy(sql`MIN(${TaskTable.queue_seq})`)
        .all()).map((row) => row.owner)
    }),
    get: Effect.fn("TaskLedger.get")((input: OwnedTask) =>
      db.transaction((tx) => owned(tx, input).pipe(Effect.map(info))),
    ),
    details: Effect.fn("TaskLedger.details")((input: OwnedTask) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const task = yield* owned(tx, input)
          const attempt = yield* tx
            .select()
            .from(AttemptTable)
            .where(eq(AttemptTable.task_id, task.id))
            .orderBy(sql`${AttemptTable.generation} DESC`)
            .limit(1)
            .get()
          return Task.Details.make({
            task: info(task),
            ...(attempt ? { attempt: intent(attempt) } : {}),
            ...(attempt?.evidence == null ? {} : { evidence: attempt.evidence }),
          })
        }),
      ),
    ),
    board: Effect.fn("TaskLedger.board")((ownerSessionID: SessionID) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* root(tx, ownerSessionID)
          const team = yield* tx.select().from(TeamTable).where(eq(TeamTable.owner_session_id, ownerSessionID)).get()
          const grouped = yield* tx
            .select({ status: TaskTable.status, count: sql<number>`COUNT(*)` })
            .from(TaskTable)
            .where(and(eq(TaskTable.owner_session_id, ownerSessionID), notDismissed))
            .groupBy(TaskTable.status)
            .all()
          const assigned = yield* tx
            .select()
            .from(TaskTable)
            .where(
              and(
                eq(TaskTable.owner_session_id, ownerSessionID),
                notDismissed,
                notInArray(TaskTable.status, ["queued", ...terminal]),
              ),
            )
            .orderBy(asc(TaskTable.queue_seq))
            .all()
          const queued = yield* tx
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.owner_session_id, ownerSessionID), notDismissed, eq(TaskTable.status, "queued")))
            .orderBy(asc(TaskTable.queue_seq))
            .limit(20)
            .all()
          const settled = yield* tx
            .select()
            .from(TaskTable)
            .where(
              and(eq(TaskTable.owner_session_id, ownerSessionID), notDismissed, inArray(TaskTable.status, terminal)),
            )
            .orderBy(desc(TaskTable.time_updated), desc(TaskTable.queue_seq))
            .limit(20)
            .all()
          const data = yield* Effect.forEach([...assigned, ...queued, ...settled], (task) =>
            Effect.gen(function* () {
              const attempt = yield* tx
                .select()
                .from(AttemptTable)
                .where(eq(AttemptTable.task_id, task.id))
                .orderBy(desc(AttemptTable.generation))
                .limit(1)
                .get()
              return Task.Details.make({
                task: info(task),
                ...(attempt ? { attempt: intent(attempt) } : {}),
                ...(attempt?.evidence == null ? {} : { evidence: attempt.evidence }),
              })
            }),
          )
          return Task.Board.make({
            data,
            team: { ownerSessionID, paused: team?.paused ?? false, timeUpdated: team?.time_updated ?? 0 },
            counts: Object.fromEntries(grouped.map((row) => [row.status, row.count])),
          })
        }),
      ),
    ),
    list: Effect.fn("TaskLedger.list")((ownerSessionID: SessionID, after = 0) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* decode(NonNegativeInt, after)
          yield* root(tx, ownerSessionID)
          return (yield* tx
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.owner_session_id, ownerSessionID), notDismissed, gt(TaskTable.queue_seq, after)))
            .orderBy(asc(TaskTable.queue_seq))
            .limit(100)
            .all()).map(info)
        }),
      ),
    ),
    events: Effect.fn("TaskLedger.events")((input: { readonly ownerSessionID: SessionID; readonly after: number }) =>
      Effect.gen(function* () {
        yield* decode(NonNegativeInt, input.after)
        const rows = yield* db
          .select()
          .from(TaskEventTable)
          .where(and(eq(TaskEventTable.owner_session_id, input.ownerSessionID), gt(TaskEventTable.seq, input.after)))
          .orderBy(asc(TaskEventTable.seq))
          .limit(100)
          .all()
        return rows.map((row) => Task.Event.make({ seq: row.seq, kind: row.kind, ...row.data }))
      }),
    ),
  }
}

function decode<S extends Schema.Top>(schema: S, input: unknown) {
  return Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => new Error({ code: "invalid_input", message: String(error) })),
  )
}

function info(row: TaskRow): Task.Info {
  return Task.Info.make({
    id: row.id,
    ownerSessionID: row.owner_session_id,
    projectID: row.project_id,
    location: { directory: row.directory, ...(row.workspace_id === null ? {} : { workspaceID: row.workspace_id }) },
    dispatchKey: row.dispatch_key,
    brief: row.brief,
    status: row.status,
    generation: row.generation,
    queueSequence: row.queue_seq,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  })
}

function intent(row: AttemptRow): Task.Attempt {
  return Task.Attempt.make({
    id: row.id,
    taskID: row.task_id,
    ownerSessionID: row.owner_session_id,
    workerSessionID: row.worker_session_id,
    inputMessageID: row.input_message_id,
    runtimeEpoch: row.runtime_epoch,
    generation: row.generation,
    slot: row.slot,
  })
}
