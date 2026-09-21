import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Automation } from "@opencode-ai/schema/automation"
import { Model } from "@opencode-ai/schema/model"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { Timestamps } from "../database/schema.sql"
import * as DatabasePath from "../database/path"
import { ProjectTable } from "../project/sql"

export const AutomationTable = sqliteTable(
  "automation",
  {
    id: text().$type<Automation.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: DatabasePath.directoryColumn().notNull(),
    name: text().notNull(),
    prompt: text().notNull(),
    kind: text().$type<Automation.Kind>().notNull(),
    target_session_id: text(),
    agent: text(),
    model: text({ mode: "json" }).$type<Model.Ref>(),
    profile: text().$type<Automation.Profile>().notNull(),
    schedule: text({ mode: "json" }).$type<Automation.Schedule>().notNull(),
    verification: text({ mode: "json" }).$type<Automation.Check[]>().notNull(),
    budget_per_run_tokens: integer(),
    budget_per_day_tokens: integer(),
    timeout_minutes: integer().notNull(),
    status: text().$type<Automation.Status>().notNull(),
    next_run_at: integer(),
    last_run_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_status_next_run_at_idx").on(table.status, table.next_run_at),
    index("automation_directory_idx").on(table.directory),
  ],
)

export const AutomationRunTable = sqliteTable(
  "automation_run",
  {
    id: text().$type<Automation.RunID>().primaryKey(),
    automation_id: text()
      .$type<Automation.ID>()
      .notNull()
      .references(() => AutomationTable.id, { onDelete: "cascade" }),
    session_id: text(),
    status: text().$type<Automation.RunStatus>().notNull(),
    outcome: text().$type<Automation.Outcome>(),
    summary: text(),
    evidence: text(),
    tokens_total: integer().notNull().default(0),
    cost: real().notNull().default(0),
    unread: integer().notNull().default(0),
    trigger: text().$type<"schedule" | "manual">().notNull(),
    scheduled_for: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_started: integer(),
    time_finished: integer(),
  },
  (table) => [
    index("automation_run_automation_time_idx").on(table.automation_id, table.time_created),
    index("automation_run_session_idx").on(table.session_id),
  ],
)
