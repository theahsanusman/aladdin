import { Effect } from "effect"
import type { DatabaseMigration } from "./migration"

export default {
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`name\` text DEFAULT '' NOT NULL,
          \`branch\` text,
          \`directory\` text,
          \`extra\` text,
          \`project_id\` text NOT NULL,
          \`time_used\` integer NOT NULL,
          CONSTRAINT \`fk_workspace_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`data_migration\` (
          \`name\` text PRIMARY KEY,
          \`time_completed\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_interaction\` (
          \`id\` text PRIMARY KEY,
          \`kind\` text NOT NULL,
          \`format\` text NOT NULL,
          \`request_id\` text NOT NULL,
          \`owner_session_id\` text NOT NULL,
          \`task_id\` text NOT NULL,
          \`attempt_id\` text NOT NULL,
          \`worker_session_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`payload\` text NOT NULL,
          \`state\` text NOT NULL,
          \`decision\` text,
          \`reason\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`expires_at\` integer,
          \`time_decided\` integer,
          CONSTRAINT \`fk_task_interaction_attempt_id_task_attempt_id_fk\` FOREIGN KEY (\`attempt_id\`) REFERENCES \`task_attempt\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_task_interaction_task_id_owner_session_id_task_ledger_id_owner_session_id_fk\` FOREIGN KEY (\`task_id\`,\`owner_session_id\`) REFERENCES \`task_ledger\`(\`id\`,\`owner_session_id\`) ON DELETE RESTRICT,
          CONSTRAINT "task_interaction_kind_check" CHECK("kind" IN ('question', 'permission')),
          CONSTRAINT "task_interaction_format_check" CHECK("format" IN ('current', 'v1')),
          CONSTRAINT "task_interaction_generation_check" CHECK("generation" > 0),
          CONSTRAINT "task_interaction_time_check" CHECK("time_created" >= 0 AND "time_updated" >= 0 AND ("expires_at" IS NULL OR "expires_at" >= 0)),
          CONSTRAINT "task_interaction_permission_expiry_check" CHECK("kind" != 'permission' OR "expires_at" IS NOT NULL),
          CONSTRAINT "task_interaction_state_check" CHECK("state" IN ('pending', 'decided', 'expired', 'invalidated')),
          CONSTRAINT "task_interaction_settlement_check" CHECK(("state" = 'pending' AND "decision" IS NULL AND "time_decided" IS NULL)
            OR ("state" != 'pending' AND "time_decided" IS NOT NULL AND ("state" != 'decided' OR "decision" IS NOT NULL)))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account_state\` (
          \`id\` integer PRIMARY KEY,
          \`active_account_id\` text,
          \`active_org_id\` text,
          CONSTRAINT \`fk_account_state_active_account_id_account_id_fk\` FOREIGN KEY (\`active_account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`control_account\` (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
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
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event_sequence\` (
          \`aggregate_id\` text PRIMARY KEY,
          \`seq\` integer NOT NULL,
          \`owner_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event\` (
          \`id\` text PRIMARY KEY,
          \`aggregate_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_event_aggregate_id_event_sequence_aggregate_id_fk\` FOREIGN KEY (\`aggregate_id\`) REFERENCES \`event_sequence\`(\`aggregate_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`permission\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_directory\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`part\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_context_epoch\` (
          \`session_id\` text PRIMARY KEY,
          \`baseline\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`baseline_seq\` integer NOT NULL,
          CONSTRAINT \`fk_session_context_epoch_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text NOT NULL,
          \`goal_objective\` text,
          \`goal_status\` text,
          \`goal_evidence\` text,
          \`goal_started\` integer,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`todo\` (
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`),
          CONSTRAINT \`fk_todo_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_share\` (
          \`session_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_share_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_attempt\` (
          \`id\` text PRIMARY KEY,
          \`task_id\` text NOT NULL,
          \`owner_session_id\` text NOT NULL,
          \`worker_session_id\` text NOT NULL,
          \`input_message_id\` text NOT NULL,
          \`runtime_epoch\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`slot\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`evidence\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_interrupted\` integer,
          \`time_released\` integer,
          CONSTRAINT \`fk_task_attempt_task_id_owner_session_id_task_ledger_id_owner_session_id_fk\` FOREIGN KEY (\`task_id\`,\`owner_session_id\`) REFERENCES \`task_ledger\`(\`id\`,\`owner_session_id\`) ON DELETE RESTRICT,
          CONSTRAINT "task_attempt_slot_check" CHECK("slot" IN (1, 2, 3)),
          CONSTRAINT "task_attempt_generation_check" CHECK("generation" > 0),
          CONSTRAINT "task_attempt_status_check" CHECK("status" IN ('starting', 'running', 'waiting_for_user', 'verifying', 'cancelling', 'interrupted', 'completed', 'failed', 'cancelled')),
          CONSTRAINT "task_attempt_release_check" CHECK(("time_released" IS NULL AND "status" NOT IN ('completed', 'failed', 'cancelled')) OR ("time_released" IS NOT NULL AND "status" IN ('completed', 'failed', 'cancelled')))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_ledger_event\` (
          \`seq\` integer PRIMARY KEY AUTOINCREMENT,
          \`task_id\` text NOT NULL,
          \`owner_session_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_task_ledger_event_task_id_owner_session_id_task_ledger_id_owner_session_id_fk\` FOREIGN KEY (\`task_id\`,\`owner_session_id\`) REFERENCES \`task_ledger\`(\`id\`,\`owner_session_id\`) ON DELETE RESTRICT
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_ledger\` (
          \`id\` text PRIMARY KEY,
          \`owner_session_id\` text NOT NULL,
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`workspace_id\` text,
          \`dispatch_key\` text NOT NULL,
          \`brief\` text NOT NULL,
          \`status\` text NOT NULL,
          \`generation\` integer DEFAULT 0 NOT NULL,
          \`queue_seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_task_ledger_owner_session_id_session_id_fk\` FOREIGN KEY (\`owner_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT \`fk_task_ledger_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "task_ledger_generation_check" CHECK("generation" >= 0),
          CONSTRAINT "task_ledger_queue_check" CHECK("queue_seq" > 0),
          CONSTRAINT "task_ledger_status_check" CHECK("status" IN ('queued', 'starting', 'running', 'waiting_for_user', 'verifying', 'cancelling', 'interrupted', 'completed', 'failed', 'cancelled'))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_team\` (
          \`owner_session_id\` text PRIMARY KEY,
          \`paused\` integer DEFAULT false NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_task_team_owner_session_id_session_id_fk\` FOREIGN KEY (\`owner_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "task_team_paused_check" CHECK("paused" IN (0, 1))
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_interaction_request_idx\` ON \`task_interaction\` (\`kind\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_interaction_owner_idx\` ON \`task_interaction\` (\`owner_session_id\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`task_interaction_attempt_idx\` ON \`task_interaction\` (\`attempt_id\`,\`state\`);`)
      yield* tx.run(
        `CREATE INDEX \`automation_run_automation_time_idx\` ON \`automation_run\` (\`automation_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`automation_run_session_idx\` ON \`automation_run\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`automation_status_next_run_at_idx\` ON \`automation\` (\`status\`,\`next_run_at\`);`,
      )
      yield* tx.run(`CREATE INDEX \`automation_directory_idx\` ON \`automation\` (\`directory\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`event_aggregate_type_seq_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`seq\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`permission_project_action_resource_idx\` ON \`permission\` (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_admitted_seq_idx\` ON \`session_input\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_promoted_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_attempt_live_slot_idx\` ON \`task_attempt\` (\`owner_session_id\`,\`slot\`) WHERE "task_attempt"."time_released" IS NULL;`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_attempt_live_task_idx\` ON \`task_attempt\` (\`task_id\`) WHERE "task_attempt"."time_released" IS NULL;`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_attempt_generation_idx\` ON \`task_attempt\` (\`task_id\`,\`generation\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`task_attempt_worker_idx\` ON \`task_attempt\` (\`worker_session_id\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`task_attempt_input_idx\` ON \`task_attempt\` (\`input_message_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`task_attempt_epoch_idx\` ON \`task_attempt\` (\`runtime_epoch\`,\`time_released\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_ledger_event_owner_seq_idx\` ON \`task_ledger_event\` (\`owner_session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_ledger_owner_dispatch_idx\` ON \`task_ledger\` (\`owner_session_id\`,\`dispatch_key\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_ledger_id_owner_idx\` ON \`task_ledger\` (\`id\`,\`owner_session_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_ledger_ready_idx\` ON \`task_ledger\` (\`owner_session_id\`,\`status\`,\`queue_seq\`);`,
      )
      yield* tx.run(`CREATE INDEX \`task_ledger_queue_seq_idx\` ON \`task_ledger\` (\`queue_seq\`);`)
    })
  },
} satisfies Omit<DatabaseMigration.Migration, "id">
