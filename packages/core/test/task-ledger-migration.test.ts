import { expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import migration from "@opencode-ai/core/database/migration/20261001171408_task_ledger"
import { testEffect } from "./lib/effect"

const it = testEffect(SqliteClient.layer({ filename: ":memory:", disableWAL: true }))

it.live("adds ledger storage to an existing database without changing or deleting chats", () =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("CREATE TABLE project (id text PRIMARY KEY)")
    yield* db.run("CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, title text NOT NULL)")
    yield* db.run("INSERT INTO project VALUES ('company_a')")
    yield* db.run("INSERT INTO session VALUES ('ses_existing', 'company_a', 'Keep this chat')")
    yield* DatabaseMigration.applyOnly(db, [migration])
    yield* DatabaseMigration.applyOnly(db, [migration])
    expect(yield* db.all("SELECT * FROM session")).toEqual([
      { id: "ses_existing", project_id: "company_a", title: "Keep this chat" },
    ])
    expect(yield* db.all("SELECT name FROM pragma_table_info('session')")).toEqual([
      { name: "id" },
      { name: "project_id" },
      { name: "title" },
    ])
    expect(yield* db.get("SELECT COUNT(*) AS count FROM task_ledger")).toEqual({ count: 0 })
    expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([])
    expect(yield* db.get("SELECT COUNT(*) AS count FROM migration")).toEqual({ count: 1 })
  }),
)
