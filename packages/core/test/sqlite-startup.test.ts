import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { layer } from "../src/database/sqlite.bun"
import { Sqlite } from "../src/database/sqlite"

test("installs the busy handler before exposing a native SQLite connection", async () => {
  const timeout = await Effect.runPromise(
    Effect.gen(function* () {
      const native = yield* Sqlite.Native
      if (!(native instanceof Database)) return yield* Effect.die("Expected the Bun SQLite connection")
      return native.query("PRAGMA busy_timeout").get()
    }).pipe(Effect.provide(layer({ filename: ":memory:" })), Effect.scoped),
  )
  expect(timeout).toEqual({ timeout: 5000 })
})
