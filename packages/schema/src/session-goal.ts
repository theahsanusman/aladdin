export * as SessionGoal from "./session-goal"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"

export const Info = Schema.Struct({
  objective: Schema.String,
  status: Schema.Literals(["active", "paused", "completed"]),
  evidence: Schema.NullOr(Schema.String),
  started: Schema.NullOr(Schema.Finite),
})
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "session.goal.updated",
  schema: {
    sessionID: SessionID,
    goal: Schema.NullOr(Info),
  },
})

export const Event = { Updated, Definitions: inventory(Updated) }
