export * as TaskInteractionStore from "./interaction"

import { and, asc, eq, gt } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schedule, Schema } from "effect"
import { SqlError } from "effect/unstable/sql/SqlError"
import { TaskInteraction } from "@opencode-ai/schema/task-interaction"
import { Task } from "@opencode-ai/schema/task"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Question } from "@opencode-ai/schema/question"
import { Permission } from "@opencode-ai/schema/permission"
import { PermissionV1 } from "@opencode-ai/schema/v1/permission"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { AttemptTable, TaskTable } from "./sql"
import { InteractionTable } from "./interaction.sql"
import { EventV2 } from "../event"
import { TaskNotice } from "@opencode-ai/schema/task-notice"

export { TaskInteraction }
type Transaction = Parameters<Parameters<Database.Interface["db"]["transaction"]>[0]>[0]
type Row = typeof InteractionTable.$inferSelect
export type OpenResult =
  | { readonly _tag: "not-worker" }
  | { readonly _tag: "worker"; readonly interaction: TaskInteraction.Info }

export class Error extends Schema.TaggedErrorClass<Error>()("TaskInteractionStore.Error", {
  code: Schema.Literals(["invalid_input", "not_found", "stale_generation", "conflict", "expired", "invalidated"]),
  message: Schema.String,
}) {}
export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@opencode/TaskInteractionStore") {}
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    return make(database.db, (interaction: TaskInteraction.Info) => Effect.gen(function* () {
      const task = yield* database.db.select().from(TaskTable).where(eq(TaskTable.id, interaction.taskID)).get().pipe(Effect.orDie)
      if (!task) return yield* Effect.die("Native interaction lost its task")
      yield* events.publish(TaskNotice.Event.Changed, { sessionID: interaction.ownerSessionID, taskID: interaction.taskID }, { location: { directory: task.directory, ...(task.workspace_id === null ? {} : { workspaceID: task.workspace_id }) } })
    }))
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node] })

function make(db: Database.Interface["db"], notify: (interaction: TaskInteraction.Info) => Effect.Effect<void>) {
  const write = <A, E, R>(body: (tx: Transaction) => Effect.Effect<A, E, R>) =>
    db.transaction(body, { behavior: "immediate" }).pipe(
      Effect.retry({
        times: 3,
        schedule: Schedule.exponential(10),
        while: (error) => error instanceof SqlError && error.reason._tag === "LockTimeoutError",
      }),
    )

  const ownership = Effect.fnUntraced(function* (tx: Transaction, workerSessionID: SessionID) {
    return yield* tx
      .select({ attempt: AttemptTable, task: TaskTable })
      .from(AttemptTable)
      .innerJoin(
        TaskTable,
        and(eq(TaskTable.id, AttemptTable.task_id), eq(TaskTable.owner_session_id, AttemptTable.owner_session_id)),
      )
      .where(eq(AttemptTable.worker_session_id, workerSessionID))
      .get()
  })
  const fenced = Effect.fnUntraced(function* (tx: Transaction, workerSessionID: SessionID, generation: number) {
    const owned = yield* ownership(tx, workerSessionID)
    if (
      !owned ||
      owned.attempt.time_released !== null ||
      owned.attempt.generation !== generation ||
      owned.task.generation !== generation ||
      !["starting", "running", "waiting_for_user", "verifying"].includes(owned.task.status) ||
      !["starting", "running", "waiting_for_user", "verifying"].includes(owned.attempt.status)
    ) {
      return yield* new Error({
        code: "stale_generation",
        message: "Worker attempt is no longer active at this generation",
      })
    }
    return owned
  })
  const owned = Effect.fnUntraced(function* (tx: Transaction, input: TaskInteraction.Owned) {
    const row = yield* tx
      .select()
      .from(InteractionTable)
      .where(and(eq(InteractionTable.id, input.id), eq(InteractionTable.owner_session_id, input.ownerSessionID)))
      .get()
    if (!row) return yield* new Error({ code: "not_found", message: "Interaction does not belong to this chat" })
    return row
  })
  const expire = Effect.fnUntraced(function* (tx: Transaction, row: Row, now: number) {
    if (row.state !== "pending" || row.expires_at === null || row.expires_at > now) return row
    const updated: Row = {
      ...row,
      state: "expired",
      time_updated: now,
      time_decided: now,
      reason: "Request deadline expired",
      decision:
        row.kind === "permission"
          ? {
              kind: "permission",
              reply: "reject",
              message: "Permission request timed out without a response.",
              automatic: true,
            }
          : null,
    }
    yield* tx.update(InteractionTable).set(updated).where(eq(InteractionTable.id, row.id))
    return updated
  })

  const open = Effect.fn("TaskInteractionStore.open")(function* (input: TaskInteraction.Open) {
    // Validate without using the projected decode result: native extension fields
    // and nested permission metadata must survive byte-for-value JSON storage.
    const identity = yield* decode(
      Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)), sessionID: SessionID }),
      input.payload,
      "ignore",
    )
    return yield* write((tx) =>
      Effect.gen(function* () {
        const candidate = yield* ownership(tx, identity.sessionID)
        if (!candidate) return { _tag: "not-worker" } as const
        const request = yield* decode(TaskInteraction.Open, input)
        const owner = yield* fenced(tx, identity.sessionID, request.generation)
        if (request.kind === "question") {
          const native = yield* decode(Question.Request, request.payload, "ignore")
          if (native.expiresAt !== undefined && native.expiresAt !== request.expiresAt)
            return yield* new Error({
              code: "invalid_input",
              message: "Question expiry must match the original payload",
            })
        }
        if (request.kind === "permission" && request.format === "current")
          yield* decode(Permission.Request, request.payload, "ignore")
        if (request.kind === "permission" && request.format === "v1")
          yield* decode(PermissionV1.Request, request.payload, "ignore")
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const existing = yield* tx
          .select()
          .from(InteractionTable)
          .where(and(eq(InteractionTable.kind, request.kind), eq(InteractionTable.request_id, identity.id)))
          .get()
        if (existing) {
          if (
            existing.attempt_id !== owner.attempt.id ||
            existing.generation !== request.generation ||
            existing.format !== request.format ||
            existing.time_created !== request.timeCreated ||
            existing.expires_at !== (request.expiresAt ?? null) ||
            !equal(existing.payload, request.payload)
          )
            return yield* new Error({
              code: "conflict",
              message: "Native request identity was reused with different ownership or payload",
            })
          return { _tag: "worker", interaction: info(yield* expire(tx, existing, now)) } as const
        }
        const row = yield* tx
          .insert(InteractionTable)
          .values({
            id: TaskInteraction.ID.create(),
            kind: request.kind,
            format: request.format,
            request_id: identity.id,
            owner_session_id: owner.task.owner_session_id,
            task_id: owner.task.id,
            attempt_id: owner.attempt.id,
            worker_session_id: owner.attempt.worker_session_id,
            generation: request.generation,
            payload: request.payload,
            state: "pending",
            time_created: request.timeCreated,
            time_updated: now,
            expires_at: request.expiresAt ?? null,
          })
          .returning()
          .get()
        if (!row) return yield* Effect.die("Interaction was not persisted")
        return { _tag: "worker", interaction: info(yield* expire(tx, row, now)) } as const
      }),
    )
  })

  const get = Effect.fn("TaskInteractionStore.get")(function* (input: TaskInteraction.Owned) {
    const request = yield* decode(TaskInteraction.Owned, input)
    return yield* write((tx) =>
      Effect.gen(function* () {
        const row = yield* owned(tx, request)
        return info(yield* expire(tx, row, DateTime.toEpochMillis(yield* DateTime.now)))
      }),
    )
  })
  const list = Effect.fn("TaskInteractionStore.list")(function* (input: {
    readonly ownerSessionID: SessionID
    readonly after?: TaskInteraction.ID
  }) {
    const request = yield* decode(
      Schema.Struct({ ownerSessionID: SessionID, after: TaskInteraction.ID.pipe(Schema.optionalKey) }),
      input,
    )
    return yield* write((tx) =>
      Effect.gen(function* () {
        const rows = yield* tx
          .select()
          .from(InteractionTable)
          .where(
            and(
              eq(InteractionTable.owner_session_id, request.ownerSessionID),
              request.after === undefined ? undefined : gt(InteractionTable.id, request.after),
            ),
          )
          .orderBy(asc(InteractionTable.id))
          .limit(100)
          .all()
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        return yield* Effect.forEach(rows, (row) => Effect.map(expire(tx, row, now), info))
      }),
    )
  })
  const decide = Effect.fn("TaskInteractionStore.decide")(function* (input: TaskInteraction.Decide) {
    const request = yield* decode(TaskInteraction.Decide, input)
    // Return terminal errors as values so deadline denial commits before the
    // caller receives an error. Failing inside the transaction would roll it back.
    const result = yield* write((tx) =>
      Effect.gen(function* () {
        const row = yield* owned(tx, request)
        const current = yield* expire(tx, row, DateTime.toEpochMillis(yield* DateTime.now))
        if (current.state === "expired")
          return new Error({ code: "expired", message: "Request deadline expired; permissions remain denied" })
        if (current.state === "invalidated")
          return new Error({ code: "invalidated", message: "Request was invalidated" })
        if (current.generation !== request.generation)
          return new Error({ code: "stale_generation", message: "Answer generation does not match the request" })
        yield* fenced(tx, current.worker_session_id, request.generation)
        if (
          current.kind === "permission"
            ? request.decision.kind !== "permission"
            : request.decision.kind === "permission"
        )
          return new Error({ code: "invalid_input", message: "Response kind does not match the native request" })
        if (request.decision.kind === "question") {
          const native = yield* decode(Question.Request, current.payload, "ignore")
          if (request.decision.answers.length !== native.questions.length)
            return new Error({ code: "invalid_input", message: "Answers must match the original question count" })
          const answers = request.decision.answers
          if (
            native.questions.some((question, index) => {
              const answer = answers[index] ?? []
              return (
                (!question.multiple && answer.length > 1) ||
                (question.custom === false &&
                  answer.some((label) => !question.options.some((option) => option.label === label)))
              )
            })
          )
            return new Error({
              code: "invalid_input",
              message: "Answer does not match the original choice or custom-answer policy",
            })
        }
        if (current.state === "decided") {
          if (!equal(current.decision, request.decision))
            return new Error({ code: "conflict", message: "Interaction already has a different decision" })
          return info(current)
        }
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const updated: Row = {
          ...current,
          state: "decided",
          decision: request.decision,
          time_decided: now,
          time_updated: now,
        }
        yield* tx.update(InteractionTable).set(updated).where(eq(InteractionTable.id, current.id))
        return info(updated)
      }),
    )
    if (result instanceof Error) return yield* result
    return result
  })
  const invalidate = Effect.fn("TaskInteractionStore.invalidate")(function* (input: {
    readonly ownerSessionID: SessionID
    readonly attemptID: Task.AttemptID
    readonly reason: string
  }) {
    const request = yield* decode(
      Schema.Struct({
        ownerSessionID: SessionID,
        attemptID: Task.AttemptID,
        reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
      }),
      input,
    )
    return yield* write((tx) =>
      Effect.gen(function* () {
        const attempt = yield* tx
          .select()
          .from(AttemptTable)
          .where(and(eq(AttemptTable.id, request.attemptID), eq(AttemptTable.owner_session_id, request.ownerSessionID)))
          .get()
        if (!attempt) return yield* new Error({ code: "not_found", message: "Attempt does not belong to this chat" })
        const rows = yield* tx
          .select()
          .from(InteractionTable)
          .where(and(eq(InteractionTable.attempt_id, attempt.id), eq(InteractionTable.state, "pending")))
          .orderBy(asc(InteractionTable.id))
          .all()
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        return yield* Effect.forEach(rows, (row) =>
          Effect.gen(function* () {
            const current = yield* expire(tx, row, now)
            if (current.state !== "pending") return info(current)
            const updated: Row = {
              ...current,
              state: "invalidated",
              reason: request.reason,
              time_updated: now,
              time_decided: now,
              decision:
                current.kind === "permission"
                  ? { kind: "permission", reply: "reject", message: request.reason, automatic: true }
                  : null,
            }
            yield* tx.update(InteractionTable).set(updated).where(eq(InteractionTable.id, current.id))
            return info(updated)
          }),
        )
      }),
    )
  })
  return {
    open: (input: TaskInteraction.Open) => open(input).pipe(Effect.tap((result) => result._tag === "worker" ? notify(result.interaction) : Effect.void)),
    list, get,
    pending: (ownerSessionID: SessionID) => write((tx) => Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      const rows = yield* tx.select().from(InteractionTable).where(and(eq(InteractionTable.owner_session_id, ownerSessionID), eq(InteractionTable.state, "pending"))).orderBy(asc(InteractionTable.id)).limit(100).all()
      const current = yield* Effect.forEach(rows, (row) => expire(tx, row, now))
      return current.filter((row) => row.state === "pending").map(info)
    })),
    decide: (input: TaskInteraction.Decide) => decide(input).pipe(Effect.tap(notify)),
    invalidate: (input: { readonly ownerSessionID: SessionID; readonly attemptID: Task.AttemptID; readonly reason: string }) => invalidate(input).pipe(Effect.tap((records) => Effect.forEach(records, notify, { discard: true }))),
  }
}

function decode<S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  input: unknown,
  onExcessProperty: "error" | "ignore" = "error",
) {
  return Schema.decodeUnknownEffect(schema)(input, { onExcessProperty }).pipe(
    Effect.mapError((error) => new Error({ code: "invalid_input", message: String(error) })),
  )
}
// JSON object key order is not part of a native request or decision's identity.
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => equal(item, right[index]))
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false
  const a = Object.entries(left)
  const b = Object.entries(right)
  return (
    a.length === b.length && a.every(([key, value]) => b.some(([other, item]) => key === other && equal(value, item)))
  )
}
function info(row: Row): TaskInteraction.Info {
  return {
    id: row.id,
    kind: row.kind,
    format: row.format,
    requestID: row.request_id,
    ownerSessionID: row.owner_session_id,
    taskID: row.task_id,
    attemptID: row.attempt_id,
    workerSessionID: row.worker_session_id,
    generation: row.generation,
    payload: row.payload,
    state: row.state,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.time_decided === null ? {} : { timeDecided: row.time_decided }),
    ...(row.decision === null ? {} : { decision: row.decision }),
    ...(row.reason === null ? {} : { reason: row.reason }),
  }
}
