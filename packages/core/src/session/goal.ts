export * as SessionGoal from "./goal"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SessionSchema } from "./schema"
import { SessionTable, TodoTable } from "./sql"

export type Info = {
  objective: string
  status: "active" | "paused" | "completed"
  evidence: string | null
}

export function prompt(goal: Info | undefined, todos: ReadonlyArray<{ content: string; status: string }>) {
  if (!goal) return
  return [
    "<aladdin-goal>",
    `Objective: ${goal.objective}`,
    `Status: ${goal.status}`,
    ...(goal.evidence ? [`Completion evidence: ${goal.evidence}`] : []),
    "Tasks:",
    ...todos.map((todo) => `- [${todo.status}] ${todo.content}`),
    "Keep this objective and task state in view across turns and compaction. New user messages may steer the active work. If status is paused, do not advance the goal until explicitly resumed. Complete only after required tasks are done and cite concrete evidence.",
    "</aladdin-goal>",
  ].join("\n")
}

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Info | undefined>
  readonly start: (input: { sessionID: SessionSchema.ID; objective: string }) => Effect.Effect<Info, Error>
  readonly pause: (sessionID: SessionSchema.ID) => Effect.Effect<Info, Error>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<Info, Error>
  readonly complete: (input: { sessionID: SessionSchema.ID; evidence: string }) => Effect.Effect<Info, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionGoal") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select({ objective: SessionTable.goal_objective, status: SessionTable.goal_status, evidence: SessionTable.goal_evidence })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row?.objective || !row.status) return
      return { objective: row.objective, status: row.status, evidence: row.evidence }
    })

    const start = Effect.fn("SessionGoal.start")(function* (input: { sessionID: SessionSchema.ID; objective: string }) {
      const objective = input.objective.trim()
      if (!objective || objective.length > 20_000) return yield* Effect.fail(new Error("A goal objective must be 1 to 20,000 characters"))
      const rows = yield* db
        .update(SessionTable)
        .set({ goal_objective: objective, goal_status: "active", goal_evidence: null })
        .where(eq(SessionTable.id, input.sessionID))
        .returning({ id: SessionTable.id })
        .all()
        .pipe(Effect.orDie)
      if (rows.length === 0) return yield* Effect.fail(new Error("Session does not exist"))
      return { objective, status: "active" as const, evidence: null }
    })

    const change = Effect.fn("SessionGoal.change")(function* (
      sessionID: SessionSchema.ID,
      status: "active" | "paused" | "completed",
      evidence: string | null = null,
    ) {
      return yield* db.transaction((tx) =>
        Effect.gen(function* () {
          const row = yield* tx
            .select({ objective: SessionTable.goal_objective, status: SessionTable.goal_status })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID))
            .get()
          if (!row?.objective || !row.status) return yield* Effect.fail(new Error("Session has no goal"))
          if (row.status === "completed") return yield* Effect.fail(new Error("Completed goals cannot be changed"))
          if (status === "completed") {
            if (!evidence?.trim() || evidence.length > 20_000) {
              return yield* Effect.fail(new Error("Completion evidence must be 1 to 20,000 characters"))
            }
            const tasks = yield* tx
              .select({ status: TodoTable.status })
              .from(TodoTable)
              .where(eq(TodoTable.session_id, sessionID))
              .all()
            if (tasks.some((task) => task.status !== "completed" && task.status !== "cancelled")) {
              return yield* Effect.fail(new Error("Complete the task list before completing the goal"))
            }
          }
          yield* tx
            .update(SessionTable)
            .set({ goal_status: status, goal_evidence: evidence?.trim() ?? null })
            .where(eq(SessionTable.id, sessionID))
            .run()
          return { objective: row.objective, status, evidence: evidence?.trim() ?? null }
        }),
      ).pipe(Effect.mapError((error) => error instanceof Error ? error : new Error(String(error))))
    })

    return Service.of({
      get,
      start,
      pause: (sessionID) => change(sessionID, "paused"),
      resume: (sessionID) => change(sessionID, "active"),
      complete: (input) => change(input.sessionID, "completed", input.evidence),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node] })
