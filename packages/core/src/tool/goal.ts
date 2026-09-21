export * as GoalTool from "./goal"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionGoal } from "../session/goal"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "goal"

export const Input = Schema.Struct({
  action: Schema.Literals(["get", "start", "pause", "resume", "complete", "clear"]),
  objective: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.String),
})

export const Output = Schema.Struct({
  objective: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.Literals(["active", "paused", "completed"])),
  evidence: Schema.NullOr(Schema.String),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const goals = yield* SessionGoal.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: "Maintain a durable session goal. Start with a clear objective, pause or resume when the user steers, and complete only with concrete evidence after all session todos are completed. Use get to inspect the current goal and clear to remove one.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.action === "get") {
                const goal = yield* goals.get(context.sessionID)
                if (!goal) return yield* Effect.fail(new ToolFailure({ message: "This session has no goal" }))
                return goal
              }
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              if (input.action === "start") {
                if (!input.objective) return yield* Effect.fail(new ToolFailure({ message: "An objective is required" }))
                return yield* goals.start({ sessionID: context.sessionID, objective: input.objective })
              }
              if (input.action === "pause") return yield* goals.pause(context.sessionID)
              if (input.action === "resume") return yield* goals.resume(context.sessionID)
              if (input.action === "clear") {
                yield* goals.clear(context.sessionID)
                return { objective: null, status: null, evidence: null }
              }
              if (!input.evidence) return yield* Effect.fail(new ToolFailure({ message: "Completion evidence is required" }))
              return yield* goals.complete({ sessionID: context.sessionID, evidence: input.evidence })
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/goal",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, SessionGoal.node],
})
