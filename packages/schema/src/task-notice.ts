export * as TaskNotice from "./task-notice"

import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { Task } from "./task"

// Shared transitional live notice. The task ledger remains the sole durable
// transition journal; clients reload/replay it rather than treating notices as
// another execution history.
const Changed = define({ type: "task.changed", schema: { sessionID: SessionID, taskID: Task.ID } })
const TeamChanged = define({ type: "task.team.changed", schema: { sessionID: SessionID } })
export const Event = { Changed, TeamChanged, Definitions: inventory(Changed, TeamChanged) }
