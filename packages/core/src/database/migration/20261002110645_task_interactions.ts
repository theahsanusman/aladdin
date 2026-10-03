import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261002110645_task_interactions",
  up(tx) {
    return Effect.gen(function* () {
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
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_interaction_request_idx\` ON \`task_interaction\` (\`kind\`,\`request_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_interaction_owner_idx\` ON \`task_interaction\` (\`owner_session_id\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`task_interaction_attempt_idx\` ON \`task_interaction\` (\`attempt_id\`,\`state\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
