export * as TaskInteraction from "./task-interaction"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { NonNegativeInt, optional, statics } from "./schema"
import { Task } from "./task"
import { SessionID } from "./session-id"
import { Question } from "./question"
import { Permission } from "./permission"

export const ID = Schema.String.check(Schema.isStartsWith("tin_"), Schema.isMinLength(5))
  .annotate({ identifier: "TaskInteraction.ID" })
  .pipe(
    Schema.brand("TaskInteraction.ID"),
    statics((schema) => ({ create: () => schema.make(`tin_${ascending()}`) })),
  )
export type ID = typeof ID.Type

export const Kind = Schema.Literals(["question", "permission"]).annotate({ identifier: "TaskInteraction.Kind" })
export type Kind = typeof Kind.Type
export const Format = Schema.Literals(["current", "v1"]).annotate({ identifier: "TaskInteraction.Format" })
export type Format = typeof Format.Type
export const State = Schema.Literals(["pending", "decided", "expired", "invalidated"]).annotate({
  identifier: "TaskInteraction.State",
})
export type State = typeof State.Type

// Native contracts differ (notably permission/action and tool/source). Keep the
// complete JSON object, including extension fields, rather than projecting it.
// Core validates the selected native contract; Schema has no V1 dependency.
export const Payload = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "TaskInteraction.Payload" })
export type Payload = typeof Payload.Type

// Native ingestion additionally checks JavaScript values before serialization.
// Wire output is already JSON and uses the portable Payload contract above.
const nativePayload = Schema.Json.check(
  Schema.makeFilter((value) => (plainJson(value) ? undefined : "Native payload must contain only plain JSON values")),
)
  .pipe(Schema.decodeTo(Schema.Record(Schema.String, Schema.Json)))

// Schema.Json accepts objects such as Date/Map; JSON.stringify changes or drops
// those values. Reject them rather than silently changing authorization details.
function plainJson(value: Schema.Json): boolean {
  if (value === null || typeof value !== "object") return true
  if (Array.isArray(value)) return Reflect.ownKeys(value).length === value.length + 1 && value.every(plainJson)
  const prototype = Object.getPrototypeOf(value)
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).length === Object.keys(value).length &&
    Object.values(value).every(plainJson)
  )
}

const open = {
  format: Format,
  generation: Task.Generation,
  payload: nativePayload,
  timeCreated: NonNegativeInt,
}
export const Open = Schema.Union([
  Schema.Struct({ ...open, kind: Schema.Literal("question"), expiresAt: NonNegativeInt.pipe(optional) }),
  Schema.Struct({ ...open, kind: Schema.Literal("permission"), expiresAt: NonNegativeInt }),
]).annotate({ identifier: "TaskInteraction.Open" })
export type Open = typeof Open.Type

export const Decision = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("question"), answers: Schema.Array(Question.Answer) }),
  Schema.Struct({ kind: Schema.Literal("question-rejection") }),
  Schema.Struct({
    kind: Schema.Literal("permission"),
    reply: Permission.Reply,
    message: Schema.String.pipe(optional),
    automatic: Schema.Boolean.pipe(optional),
  }),
]).annotate({ identifier: "TaskInteraction.Decision" })
export type Decision = typeof Decision.Type

export const Info = Schema.Struct({
  id: ID,
  kind: Kind,
  format: Format,
  requestID: Schema.String,
  ownerSessionID: SessionID,
  taskID: Task.ID,
  attemptID: Task.AttemptID,
  workerSessionID: SessionID,
  generation: Task.Generation,
  payload: Payload,
  timeCreated: NonNegativeInt,
  timeUpdated: NonNegativeInt,
  expiresAt: NonNegativeInt.pipe(optional),
  timeDecided: NonNegativeInt.pipe(optional),
  state: State,
  decision: Decision.pipe(optional),
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "TaskInteraction.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Owned = Schema.Struct({ ownerSessionID: SessionID, id: ID }).annotate({
  identifier: "TaskInteraction.Owned",
})
export interface Owned extends Schema.Schema.Type<typeof Owned> {}
export const Decide = Schema.Struct({ ...Owned.fields, generation: Task.Generation, decision: Decision }).annotate({
  identifier: "TaskInteraction.Decide",
})
export interface Decide extends Schema.Schema.Type<typeof Decide> {}
