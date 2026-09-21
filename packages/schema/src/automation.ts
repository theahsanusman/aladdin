export * as Automation from "./automation"

import { Schema } from "effect"
import { descending } from "./identifier"
import { define, inventory } from "./event"
import { AbsolutePath, NonNegativeInt, PositiveInt, optional, statics } from "./schema"
import { Model } from "./model"
import { ProjectID } from "./project-id"

export const ID = Schema.String.check(Schema.isStartsWith("atm_")).pipe(
  Schema.brand("Automation.ID"),
  statics((schema) => ({ create: () => schema.make("atm_" + descending()) })),
)
export type ID = typeof ID.Type

export const RunID = Schema.String.check(Schema.isStartsWith("atr_")).pipe(
  Schema.brand("Automation.RunID"),
  statics((schema) => ({ create: () => schema.make("atr_" + descending()) })),
)
export type RunID = typeof RunID.Type

export const Kind = Schema.Literals(["standalone", "thread"])
export type Kind = typeof Kind.Type

export const Status = Schema.Literals(["active", "paused"])
export type Status = typeof Status.Type

export const Profile = Schema.Literals(["read-only", "workspace-write", "full"])
export type Profile = typeof Profile.Type

export const RunStatus = Schema.Literals(["queued", "running", "done", "failed", "skipped"])
export type RunStatus = typeof RunStatus.Type

export const Outcome = Schema.Literals([
  "verified",
  "reported",
  "verification_failed",
  "budget_exceeded",
  "budget_exhausted",
  "timed_out",
  "provider_error",
  "project_unavailable",
  "session_unavailable",
  "previous_run_active",
  "cancelled",
])
export type Outcome = typeof Outcome.Type

const TimeOfDay = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/))
const CronExpression = Schema.String.check(Schema.isMinLength(1))

export const Schedule = Schema.Union([
  Schema.Struct({ type: Schema.Literal("interval"), minutes: PositiveInt }),
  Schema.Struct({ type: Schema.Literal("daily"), time: TimeOfDay }),
  Schema.Struct({ type: Schema.Literal("weekly"), weekday: NonNegativeInt, time: TimeOfDay }),
  Schema.Struct({ type: Schema.Literal("monthly"), day: PositiveInt, time: TimeOfDay }),
  Schema.Struct({ type: Schema.Literal("cron"), expression: CronExpression }),
]).annotate({ discriminator: "type", identifier: "Automation.Schedule" })
export type Schedule = Schema.Schema.Type<typeof Schedule>

export const Check = Schema.Struct({
  command: Schema.String,
  timeoutSeconds: PositiveInt.pipe(optional),
}).annotate({ identifier: "Automation.Check" })
export interface Check extends Schema.Schema.Type<typeof Check> {}

const Time = Schema.Struct({ created: Schema.Finite, updated: Schema.Finite })

export const Info = Schema.Struct({
  id: ID,
  projectID: ProjectID,
  directory: AbsolutePath,
  name: Schema.String,
  prompt: Schema.String,
  kind: Kind,
  targetSessionID: Schema.String.pipe(optional),
  agent: Schema.String.pipe(optional),
  model: Model.Ref.pipe(optional),
  profile: Profile,
  schedule: Schedule,
  verification: Schema.Array(Check),
  budgetPerRunTokens: PositiveInt.pipe(optional),
  budgetPerDayTokens: PositiveInt.pipe(optional),
  timeoutMinutes: PositiveInt,
  status: Status,
  nextRunAt: Schema.Finite.pipe(optional),
  lastRunAt: Schema.Finite.pipe(optional),
  time: Time,
}).annotate({ identifier: "Automation.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Run = Schema.Struct({
  id: RunID,
  automationID: ID,
  sessionID: Schema.String.pipe(optional),
  status: RunStatus,
  outcome: Outcome.pipe(optional),
  summary: Schema.String.pipe(optional),
  evidence: Schema.String.pipe(optional),
  tokensTotal: NonNegativeInt,
  cost: Schema.Finite,
  unread: Schema.Boolean,
  trigger: Schema.Literals(["schedule", "manual"]),
  scheduledFor: Schema.Finite.pipe(optional),
  time: Schema.Struct({
    created: Schema.Finite,
    started: Schema.Finite.pipe(optional),
    finished: Schema.Finite.pipe(optional),
  }),
}).annotate({ identifier: "Automation.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}

const Updated = define({
  type: "automation.updated",
  schema: { automation: Schema.NullOr(Info) },
})

const RunUpdated = define({
  type: "automation.run.updated",
  schema: { run: Run },
})

export const Event = { Updated, RunUpdated, Definitions: inventory(Updated, RunUpdated) }
