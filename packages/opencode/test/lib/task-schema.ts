import { afterAll, beforeAll, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { tmpdir } from "../fixture/fixture"

const temporary = await tmpdir()
let statements: string[] = []
beforeAll(async () => {
  // The main workstream owns the production migration. Exercise the actual new
  // table definition in an isolated test fixture, never generated repo files.
  const child = Bun.spawn(
    [
      "bun",
      "drizzle-kit",
      "generate",
      "--dialect",
      "sqlite",
      "--schema",
      new URL("../fixture/task-runtime-schema.ts", import.meta.url).pathname,
      "--out",
      temporary.path,
    ],
    { cwd: new URL("../../../core", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(child.stdout).text()
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, output + errors).toBe(0)
  const files = await Array.fromAsync(new Bun.Glob("**/migration.sql").scan({ cwd: temporary.path }))
  expect(files).toHaveLength(1)
  statements = (await Bun.file(`${temporary.path}/${files[0]}`).text())
    .split("--> statement-breakpoint")
    .filter((value) => value.trim())
})
afterAll(() => temporary[Symbol.asyncDispose]())

export const installTaskInteractionSchema = Effect.gen(function* () {
  const database = yield* Database.Service
  const exists = yield* database.db.get(sql`SELECT name FROM sqlite_master WHERE name = 'task_interaction'`)
  if (!statements.length) return yield* Effect.die(`Task fixture schema was not initialized: ${JSON.stringify(exists)}`)
  if (exists) return
  yield* Effect.forEach(statements, (statement) => database.db.run(sql.raw(statement)), { discard: true })
})
