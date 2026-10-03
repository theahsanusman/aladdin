import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261002115135_task_team",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`task_team\` (
          \`owner_session_id\` text PRIMARY KEY,
          \`paused\` integer DEFAULT false NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_task_team_owner_session_id_session_id_fk\` FOREIGN KEY (\`owner_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE RESTRICT,
          CONSTRAINT "task_team_paused_check" CHECK("paused" IN (0, 1))
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
