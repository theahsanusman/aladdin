import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Task } from "@opencode-ai/schema/task"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { WorkspaceID } from "@opencode-ai/schema/workspace-id"
import { absoluteColumn } from "../database/path"
import { SessionTable } from "../session/sql"
import { ProjectTable } from "../project/sql"

export const TeamTable = sqliteTable("task_team", {
  owner_session_id: text().$type<SessionID>().primaryKey().notNull().references(() => SessionTable.id, { onDelete: "restrict" }),
  paused: integer({ mode: "boolean" }).notNull().default(false),
  time_updated: integer().notNull(),
}, (table) => [check("task_team_paused_check", sql`${table.paused} IN (0, 1)`)])

export const TaskTable = sqliteTable(
  "task_ledger",
  {
    id: text().$type<Task.ID>().primaryKey(),
    owner_session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "restrict" }),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "restrict" }),
    directory: absoluteColumn().notNull(),
    workspace_id: text().$type<WorkspaceID>(),
    dispatch_key: text().notNull(),
    brief: text({ mode: "json" }).$type<Task.Brief>().notNull(),
    status: text().$type<Task.Status>().notNull(),
    generation: integer().notNull().default(0),
    queue_seq: integer().notNull(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    uniqueIndex("task_ledger_owner_dispatch_idx").on(table.owner_session_id, table.dispatch_key),
    uniqueIndex("task_ledger_id_owner_idx").on(table.id, table.owner_session_id),
    index("task_ledger_ready_idx").on(table.owner_session_id, table.status, table.queue_seq),
    index("task_ledger_queue_seq_idx").on(table.queue_seq),
    check("task_ledger_generation_check", sql`${table.generation} >= 0`),
    check("task_ledger_queue_check", sql`${table.queue_seq} > 0`),
    check(
      "task_ledger_status_check",
      sql`${table.status} IN ('queued', 'starting', 'running', 'waiting_for_user', 'verifying', 'cancelling', 'interrupted', 'completed', 'failed', 'cancelled')`,
    ),
  ],
)

export const AttemptTable = sqliteTable(
  "task_attempt",
  {
    id: text().$type<Task.AttemptID>().primaryKey(),
    task_id: text().$type<Task.ID>().notNull(),
    owner_session_id: text().$type<SessionID>().notNull(),
    worker_session_id: text().$type<SessionID>().notNull(),
    input_message_id: text().$type<SessionMessage.ID>().notNull(),
    runtime_epoch: text().notNull(),
    generation: integer().notNull(),
    slot: integer().$type<Task.Slot>().notNull(),
    status: text().$type<Task.Status>().notNull(),
    evidence: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
    time_interrupted: integer(),
    time_released: integer(),
  },
  (table) => [
    foreignKey({
      columns: [table.task_id, table.owner_session_id],
      foreignColumns: [TaskTable.id, TaskTable.owner_session_id],
    }).onDelete("restrict"),
    uniqueIndex("task_attempt_live_slot_idx")
      .on(table.owner_session_id, table.slot)
      .where(sql`${table.time_released} IS NULL`),
    uniqueIndex("task_attempt_live_task_idx")
      .on(table.task_id)
      .where(sql`${table.time_released} IS NULL`),
    uniqueIndex("task_attempt_generation_idx").on(table.task_id, table.generation),
    uniqueIndex("task_attempt_worker_idx").on(table.worker_session_id),
    uniqueIndex("task_attempt_input_idx").on(table.input_message_id),
    index("task_attempt_epoch_idx").on(table.runtime_epoch, table.time_released),
    check("task_attempt_slot_check", sql`${table.slot} IN (1, 2, 3)`),
    check("task_attempt_generation_check", sql`${table.generation} > 0`),
    check(
      "task_attempt_status_check",
      sql`${table.status} IN ('starting', 'running', 'waiting_for_user', 'verifying', 'cancelling', 'interrupted', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "task_attempt_release_check",
      sql`(${table.time_released} IS NULL AND ${table.status} NOT IN ('completed', 'failed', 'cancelled')) OR (${table.time_released} IS NOT NULL AND ${table.status} IN ('completed', 'failed', 'cancelled'))`,
    ),
  ],
)

// The single durable transition journal will be the notification outbox for
// the execution/UI slice. No event is published before its transaction commits.
export const TaskEventTable = sqliteTable(
  "task_ledger_event",
  {
    seq: integer().primaryKey({ autoIncrement: true }),
    task_id: text().$type<Task.ID>().notNull(),
    owner_session_id: text().$type<SessionID>().notNull(),
    kind: text().$type<Task.EventKind>().notNull(),
    data: text({ mode: "json" }).$type<Omit<Task.Event, "seq" | "kind">>().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.task_id, table.owner_session_id],
      foreignColumns: [TaskTable.id, TaskTable.owner_session_id],
    }).onDelete("restrict"),
    index("task_ledger_event_owner_seq_idx").on(table.owner_session_id, table.seq),
  ],
)
