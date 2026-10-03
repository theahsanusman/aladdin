export * as TaskDispatchTool from "./dispatch-tool"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { Task } from "@opencode-ai/schema/task"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"
import { ToolRegistry } from "../tool/registry"
import { TaskExecution } from "./execution"
import { SessionStore } from "../session/store"

export const name = "task_dispatch"
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const executor = yield* TaskExecution.Service
    const sessions = yield* SessionStore.Service
    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Admit Michael work to this root chat's durable queue and return immediately. Native mode uses Michael's normal tools and chat permissions; report/research are restricted and coding uses an isolated worktree. Snapshot the current engine, selected model/reasoning and budgets. Give workers separate file ownership and preserve user edits. Do not wait or poll.",
          input: Task.DispatchInput,
          output: Schema.Struct({ taskID: Task.ID, status: Task.Status }),
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.brief.execution.engine !== "v2")
                return yield* new ToolFailure({
                  message: "The canonical V2 dispatcher requires a V2 worker engine snapshot",
                })
              const lead = yield* sessions.message(context.assistantMessageID)
              if (
                lead?.sessionID !== context.sessionID ||
                lead.message.type !== "assistant" ||
                lead.message.agent !== context.agent
              )
                return yield* new ToolFailure({ message: "Dispatch requires the owning lead turn" })
              yield* permission.assert({
                action: name,
                resources: [input.brief.title],
                save: [],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const task = yield* executor.dispatch({
                ...input,
                brief: {
                  ...input.brief,
                  execution: {
                    ...input.brief.execution,
                    agent: "michael",
                    model: { ...lead.message.model, variant: lead.message.model.variant ?? "default" },
                  },
                },
                ownerSessionID: context.sessionID,
              })
              return { taskID: task.id, status: task.status }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: String(error) }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
// Opt-in only; not added to shipped built-ins and not a replacement for V1 task.
export const node = makeLocationNode({
  name: "TaskDispatchTool",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, TaskExecution.node, SessionStore.node],
})
