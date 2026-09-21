import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260921165254_aladdin_automations",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`automation_run\` (
          \`id\` text PRIMARY KEY,
          \`automation_id\` text NOT NULL,
          \`session_id\` text,
          \`status\` text NOT NULL,
          \`outcome\` text,
          \`summary\` text,
          \`evidence\` text,
          \`tokens_total\` integer DEFAULT 0 NOT NULL,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`unread\` integer DEFAULT 0 NOT NULL,
          \`trigger\` text NOT NULL,
          \`scheduled_for\` integer,
          \`time_created\` integer NOT NULL,
          \`time_started\` integer,
          \`time_finished\` integer,
          CONSTRAINT \`fk_automation_run_automation_id_automation_id_fk\` FOREIGN KEY (\`automation_id\`) REFERENCES \`automation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`automation\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`name\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`target_session_id\` text,
          \`agent\` text,
          \`model\` text,
          \`profile\` text NOT NULL,
          \`schedule\` text NOT NULL,
          \`verification\` text NOT NULL,
          \`budget_per_run_tokens\` integer,
          \`budget_per_day_tokens\` integer,
          \`timeout_minutes\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`next_run_at\` integer,
          \`last_run_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_automation_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`automation_run_automation_time_idx\` ON \`automation_run\` (\`automation_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`automation_run_session_idx\` ON \`automation_run\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`automation_status_next_run_at_idx\` ON \`automation\` (\`status\`,\`next_run_at\`);`,
      )
      yield* tx.run(`CREATE INDEX \`automation_directory_idx\` ON \`automation\` (\`directory\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
