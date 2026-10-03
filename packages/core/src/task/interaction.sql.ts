import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { TaskInteraction } from "@opencode-ai/schema/task-interaction"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Task } from "@opencode-ai/schema/task"
import { AttemptTable, TaskTable } from "./sql"

export const InteractionTable = sqliteTable(
  "task_interaction",
  {
    id: text().$type<TaskInteraction.ID>().primaryKey(),
    kind: text().$type<TaskInteraction.Kind>().notNull(),
    format: text().$type<TaskInteraction.Format>().notNull(),
    request_id: text().notNull(),
    owner_session_id: text().$type<SessionID>().notNull(),
    task_id: text().$type<Task.ID>().notNull(),
    attempt_id: text()
      .$type<Task.AttemptID>()
      .notNull()
      .references(() => AttemptTable.id, { onDelete: "restrict" }),
    worker_session_id: text().$type<SessionID>().notNull(),
    generation: integer().notNull(),
    payload: text({ mode: "json" }).$type<TaskInteraction.Payload>().notNull(),
    state: text().$type<TaskInteraction.State>().notNull(),
    decision: text({ mode: "json" }).$type<TaskInteraction.Decision>(),
    reason: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
    expires_at: integer(),
    time_decided: integer(),
  },
  (table) => [
    foreignKey({
      columns: [table.task_id, table.owner_session_id],
      foreignColumns: [TaskTable.id, TaskTable.owner_session_id],
    }).onDelete("restrict"),
    uniqueIndex("task_interaction_request_idx").on(table.kind, table.request_id),
    index("task_interaction_owner_idx").on(table.owner_session_id, table.id),
    index("task_interaction_attempt_idx").on(table.attempt_id, table.state),
    check("task_interaction_kind_check", sql`${table.kind} IN ('question', 'permission')`),
    check("task_interaction_format_check", sql`${table.format} IN ('current', 'v1')`),
    check("task_interaction_generation_check", sql`${table.generation} > 0`),
    check(
      "task_interaction_time_check",
      sql`${table.time_created} >= 0 AND ${table.time_updated} >= 0 AND (${table.expires_at} IS NULL OR ${table.expires_at} >= 0)`,
    ),
    check(
      "task_interaction_permission_expiry_check",
      sql`${table.kind} != 'permission' OR ${table.expires_at} IS NOT NULL`,
    ),
    check("task_interaction_state_check", sql`${table.state} IN ('pending', 'decided', 'expired', 'invalidated')`),
    check(
      "task_interaction_settlement_check",
      sql`(${table.state} = 'pending' AND ${table.decision} IS NULL AND ${table.time_decided} IS NULL)
    OR (${table.state} != 'pending' AND ${table.time_decided} IS NOT NULL AND (${table.state} != 'decided' OR ${table.decision} IS NOT NULL))`,
    ),
  ],
)
