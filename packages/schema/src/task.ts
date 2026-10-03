export * as Task from "./task"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { Location } from "./location"
import { ProjectID } from "./project-id"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"
import { NonNegativeInt, PositiveInt, optional, statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("tsk_"), Schema.isMinLength(5))
  .annotate({ identifier: "Task.ID" })
  .pipe(
    Schema.brand("Task.ID"),
    statics((schema) => ({ create: () => schema.make(`tsk_${ascending()}`) })),
  )
export type ID = typeof ID.Type

export const AttemptID = Schema.String.check(Schema.isStartsWith("tat_"), Schema.isMinLength(5))
  .annotate({ identifier: "Task.AttemptID" })
  .pipe(
    Schema.brand("Task.AttemptID"),
    statics((schema) => ({ create: () => schema.make(`tat_${ascending()}`) })),
  )
export type AttemptID = typeof AttemptID.Type

const text = (maximum: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum), Schema.isPattern(/\S/))
const items = Schema.Array(text(2_000)).check(Schema.isMaxLength(100))

// Optional only for previously admitted ledger-only tasks. Execution refuses
// these records until an explicit new, configured dispatch is admitted.
export const Execution = Schema.Struct({
  engine: Schema.Literals(["v1", "v2"]),
  agent: text(200),
  model: Schema.Struct({ id: text(200), providerID: text(200), variant: optional(text(200)) }),
  mode: Schema.Literals(["native", "report", "research", "coding"]),
  paths: optional(
    Schema.Array(
      text(2_000).check(
        Schema.isPattern(
          /^(?![\\/]|[A-Za-z]:)(?!.*(?:^|[\\/])(?:\.\.|\.git|\.opencode|\.env(?:\.[^\\/]*)?|opencode\.jsonc?)(?:[\\/]|$))[^\0]+$/,
        ),
      ),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ),
  baseRevision: optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{40,64}$/))),
  maxCalls: PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
  maxToolCalls: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(1_000))),
  wallClockMs: PositiveInt.check(Schema.isLessThanOrEqualTo(86_400_000)),
}).annotate({ identifier: "Task.Execution" })
export interface Execution extends Schema.Schema.Type<typeof Execution> {}

export const Brief = Schema.Struct({
  title: text(200),
  objective: text(20_000),
  scope: items.check(Schema.isMinLength(1)),
  output: text(10_000),
  checks: items.check(Schema.isMinLength(1)),
  constraints: items,
  execution: optional(Execution),
}).annotate({ identifier: "Task.Brief" })
export interface Brief extends Schema.Schema.Type<typeof Brief> {}

export const Dispatch = Schema.Struct({
  ownerSessionID: SessionID,
  dispatchKey: text(200),
  brief: Brief,
}).annotate({ identifier: "Task.Dispatch" })
export interface Dispatch extends Schema.Schema.Type<typeof Dispatch> {}

export const Status = Schema.Literals([
  "queued",
  "starting",
  "running",
  "waiting_for_user",
  "verifying",
  "cancelling",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
]).annotate({ identifier: "Task.Status" })
export type Status = typeof Status.Type

export const Slot = Schema.Literals([1, 2, 3]).annotate({ identifier: "Task.Slot" })
export type Slot = typeof Slot.Type
export const Generation = PositiveInt.annotate({ identifier: "Task.Generation" })
export const RuntimeEpoch = text(200).annotate({ identifier: "Task.RuntimeEpoch" })

export const Info = Schema.Struct({
  id: ID,
  ownerSessionID: SessionID,
  projectID: ProjectID,
  location: Location.Ref,
  dispatchKey: Schema.String,
  brief: Brief,
  status: Status,
  generation: NonNegativeInt,
  queueSequence: PositiveInt,
  timeCreated: NonNegativeInt,
  timeUpdated: NonNegativeInt,
}).annotate({ identifier: "Task.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Team = Schema.Struct({
  ownerSessionID: SessionID,
  paused: Schema.Boolean,
  timeUpdated: NonNegativeInt,
}).annotate({ identifier: "Task.Team" })
export interface Team extends Schema.Schema.Type<typeof Team> {}

// Claims are durable dispatch intents. The worker Session and input IDs exist
// before the execution adapter creates or admits either record.
export const Attempt = Schema.Struct({
  id: AttemptID,
  taskID: ID,
  ownerSessionID: SessionID,
  workerSessionID: SessionID,
  inputMessageID: SessionMessage.ID,
  runtimeEpoch: RuntimeEpoch,
  generation: Generation,
  slot: Slot,
}).annotate({ identifier: "Task.Attempt" })
export interface Attempt extends Schema.Schema.Type<typeof Attempt> {}

export const Details = Schema.Struct({
  task: Info,
  attempt: optional(Attempt),
  evidence: optional(Schema.String),
}).annotate({ identifier: "Task.Details" })
export interface Details extends Schema.Schema.Type<typeof Details> {}

export const Board = Schema.Struct({
  data: Schema.Array(Details),
  team: Team,
  counts: Schema.Record(Schema.String, NonNegativeInt),
}).annotate({ identifier: "Task.Board" })
export interface Board extends Schema.Schema.Type<typeof Board> {}

export const Settlement = Schema.Struct({
  outcome: Schema.Literals(["completed", "failed", "cancelled"]),
  evidence: text(20_000),
}).annotate({ identifier: "Task.Settlement" })
export interface Settlement extends Schema.Schema.Type<typeof Settlement> {}

export const EventKind = Schema.Literals([
  "admitted",
  "claimed",
  "transitioned",
  "cancel_requested",
  "settled",
  "interrupted",
  "retried",
]).annotate({ identifier: "Task.EventKind" })
export type EventKind = typeof EventKind.Type

export const State = Schema.Struct({
  id: ID,
  ownerSessionID: SessionID,
  status: Status,
  generation: NonNegativeInt,
  queueSequence: PositiveInt,
  timeUpdated: NonNegativeInt,
}).annotate({ identifier: "Task.State" })
export interface State extends Schema.Schema.Type<typeof State> {}

export const Event = Schema.Struct({
  seq: PositiveInt,
  kind: EventKind,
  task: State,
  attempt: optional(Attempt),
  evidence: optional(Schema.String),
}).annotate({ identifier: "Task.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}
