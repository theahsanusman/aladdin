import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionGoal } from "@opencode-ai/core/session/goal"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { EventV2 } from "@opencode-ai/core/event"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionTodo.node, SessionGoal.node])))
const sessionID = SessionV2.ID.make("ses_goal_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "goal", directory: "/project", title: "goal", version: "test" })
    .run()
    .pipe(Effect.orDie)
})

describe("SessionGoal", () => {
  it.effect("persists objectives and guards completion until tasks and evidence are ready", () =>
    Effect.gen(function* () {
      yield* setup
      const goals = yield* SessionGoal.Service
      const todos = yield* SessionTodo.Service
      expect(yield* goals.get(sessionID)).toBeUndefined()
      expect(yield* goals.start({ sessionID, objective: "  Ship Aladdin  " })).toEqual({
        objective: "Ship Aladdin",
        status: "active",
        evidence: null,
        started: expect.any(Number),
      })
      yield* todos.update({ sessionID, todos: [{ content: "Verify voice", status: "pending", priority: "high" }] })
      expect(SessionGoal.prompt(yield* goals.get(sessionID), yield* todos.get(sessionID))).toContain(
        "- [pending] Verify voice",
      )
      expect(yield* goals.pause(sessionID)).toMatchObject({ status: "paused" })
      expect(yield* goals.resume(sessionID)).toMatchObject({ status: "active" })
      expect(yield* Effect.exit(goals.complete({ sessionID, evidence: "" }))).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.exit(goals.complete({ sessionID, evidence: "Voice tested" }))).toMatchObject({ _tag: "Failure" })
      yield* todos.update({ sessionID, todos: [{ content: "Verify voice", status: "completed", priority: "high" }] })
      expect(yield* goals.complete({ sessionID, evidence: "Voice tested" })).toEqual({
        objective: "Ship Aladdin",
        status: "completed",
        evidence: "Voice tested",
        started: expect.any(Number),
      })
      expect(yield* goals.get(sessionID)).toMatchObject({ status: "completed", evidence: "Voice tested" })
    }),
  )

  it.effect("keeps the start time across pauses and clears the goal completely", () =>
    Effect.gen(function* () {
      yield* setup
      const goals = yield* SessionGoal.Service
      const started = (yield* goals.start({ sessionID, objective: "Stay steady" })).started
      expect(yield* goals.pause(sessionID)).toMatchObject({ status: "paused", started })
      expect(yield* goals.resume(sessionID)).toMatchObject({ status: "active", started })
      yield* goals.clear(sessionID)
      expect(yield* goals.get(sessionID)).toBeUndefined()
      expect(yield* Effect.exit(goals.pause(sessionID))).toMatchObject({ _tag: "Failure" })
    }),
  )

  test("reloads the goal after closing and reopening the SQLite database", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aladdin-goal-"))
    try {
      const filename = path.join(directory, "goal.sqlite")
      const run = <A, E>(effect: Effect.Effect<A, E, Database.Service | SessionGoal.Service>) =>
        Effect.runPromise(
          effect.pipe(
            Effect.provide(
              AppNodeBuilder.build(LayerNode.group([Database.node, SessionGoal.node]), [
                [
                  Database.node,
                  makeGlobalNode({ service: Database.Service, layer: Database.layerFromPath(filename), deps: [] }),
                ],
              ]),
            ),
            Effect.scoped,
          ),
        )
      await run(Effect.gen(function* () {
        yield* setup
        yield* (yield* SessionGoal.Service).start({ sessionID, objective: "Survive restart" })
      }))
      expect(await run(Effect.gen(function* () {
        return yield* (yield* SessionGoal.Service).get(sessionID)
      }))).toEqual({ objective: "Survive restart", status: "active", evidence: null, started: expect.any(Number) })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
