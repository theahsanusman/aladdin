import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260920105150_handy_nico_minoru",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`goal_started\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
