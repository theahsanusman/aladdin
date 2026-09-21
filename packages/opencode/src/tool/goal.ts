import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { SessionGoal } from "@opencode-ai/core/session/goal"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["get", "start", "pause", "resume", "complete", "clear"]),
  objective: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.String),
})

export const GoalTool = Tool.define<typeof Parameters, Record<string, never>, SessionGoal.Service>(
  "goal",
  Effect.gen(function* () {
    const goals = yield* SessionGoal.Service
    return {
      description:
        "Maintain a durable session goal. Start with a clear objective, pause or resume when the user steers, and complete only with concrete evidence after all session todos are completed. Use get to inspect the current goal.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Record<string, never>>) =>
        Effect.gen(function* () {
          if (params.action !== "get") {
            yield* ctx.ask({ permission: "goal", patterns: ["*"], always: ["*"], metadata: {} })
          }
          if (params.action === "clear") {
            yield* goals.clear(ctx.sessionID)
            return {
              title: "Goal cleared",
              output: JSON.stringify({ objective: null }),
              metadata: {},
            }
          }
          const result = params.action === "get"
            ? yield* goals.get(ctx.sessionID)
            : params.action === "start"
              ? yield* goals.start({ sessionID: ctx.sessionID, objective: params.objective ?? "" })
              : params.action === "pause"
                ? yield* goals.pause(ctx.sessionID)
                : params.action === "resume"
                  ? yield* goals.resume(ctx.sessionID)
                  : yield* goals.complete({ sessionID: ctx.sessionID, evidence: params.evidence ?? "" })
          return {
            title: result ? `Goal ${result.status}` : "No goal",
            output: JSON.stringify(result ?? { objective: null }),
            metadata: {},
          }
        }).pipe(
          Effect.catch((error) => Effect.succeed({ title: "Goal error", output: error.message, metadata: {} })),
        ),
    } satisfies Tool.DefWithoutID<typeof Parameters, Record<string, never>>
  }),
)
