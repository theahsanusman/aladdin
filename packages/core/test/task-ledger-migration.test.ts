import { expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import migration from "@opencode-ai/core/database/migration/20261001171408_task_ledger"
import dismissal from "@opencode-ai/core/database/migration/20261003143112_task_dismissed"
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

it.live("adds job dismissal to a populated ledger without rewriting stored tasks", () =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("CREATE TABLE project (id text PRIMARY KEY)")
    yield* db.run("CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, title text NOT NULL)")
    yield* db.run("INSERT INTO project VALUES ('company_a')")
    yield* db.run("INSERT INTO session VALUES ('ses_existing', 'company_a', 'Keep this chat')")
    yield* DatabaseMigration.applyOnly(db, [migration])
    yield* db.run(
      `INSERT INTO task_ledger
         (id, owner_session_id, project_id, directory, dispatch_key, brief, status, generation, queue_seq,
          time_created, time_updated)
       VALUES
         ('tsk_kept', 'ses_existing', 'company_a', '/company-a', 'keep', '{"title":"Keep","objective":"Stored","scope":["/company-a"],"output":"Report","checks":["ok"],"constraints":[]}', 'cancelled', 0, 1, 1, 1)`,
    )
    yield* DatabaseMigration.applyOnly(db, [dismissal])
    yield* DatabaseMigration.applyOnly(db, [dismissal])
    expect(yield* db.get("SELECT name FROM pragma_table_info('task_ledger') WHERE name = 'time_dismissed'")).toEqual({
      name: "time_dismissed",
    })
    expect(yield* db.get("SELECT id, status, dispatch_key, time_dismissed FROM task_ledger")).toEqual({
      id: "tsk_kept",
      status: "cancelled",
      dispatch_key: "keep",
      time_dismissed: null,
    })
    expect(yield* db.all("SELECT id FROM session WHERE title = 'Keep this chat'")).toEqual([{ id: "ses_existing" }])
    expect(yield* db.all("PRAGMA foreign_key_check")).toEqual([])
    expect(yield* db.get("SELECT COUNT(*) AS count FROM migration")).toEqual({ count: 2 })
  }),
)
