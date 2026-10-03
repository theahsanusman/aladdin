import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261003143112_task_dismissed",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task_ledger\` ADD \`time_dismissed\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
