import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260920025259_aladdin_session_goal",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`goal_objective\` text;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`goal_status\` text;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`goal_evidence\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
