import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261001171408_task_ledger",
  up(tx) {
    return Effect.gen(function* () {
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
} satisfies DatabaseMigration.Migration
