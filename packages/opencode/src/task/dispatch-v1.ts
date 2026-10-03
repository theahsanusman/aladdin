import { Effect, Schema } from "effect"
import { Task } from "@opencode-ai/schema/task"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { Database } from "@opencode-ai/core/database/database"
import { define, type Context } from "../tool/tool"
import { ToolJsonSchema } from "../tool/json-schema"
import { MessageV2 } from "../session/message-v2"

// The model is advertised a single structured brief object. Decoding still
// accepts a provider-serialized brief so a historical double-encoded call keeps
// validating against exactly the same shape.
export const Parameters = Schema.Struct({
  dispatchKey: Task.Dispatch.fields.dispatchKey,
  brief: Schema.Union([Task.DispatchBrief, Schema.fromJsonString(Task.DispatchBrief)]),
})

export const jsonSchema = ToolJsonSchema.fromSchema(Task.DispatchInput)

/** Opt-in V1-native leaf. Main adds it to the dispatcher role's native registry;
 * the existing legacy task tool is intentionally untouched. */
export const Tool = define(
  "task_dispatch",
  Effect.gen(function* () {
    const tasks = yield* TaskExecution.Service
    const database = yield* Database.Service
    return {
      description:
        "Admit a complete brief to this chat's durable queue and return immediately. Required brief fields: title, objective, scope (nonempty string array), output, checks (nonempty string array), constraints (string array), execution. Execution requires engine v1, agent michael, model {id, providerID, variant}, mode (native/report/research/coding), maxCalls and wallClockMs; maxToolCalls is optional. Native is normal Michael execution with shell and installed MCP/browser tools under existing chat permissions; use it for ordinary work and audits needing those tools. Give separate file ownership and preserve user edits. Report/research are deliberately restricted; coding uses an isolated worktree with edit/write only. The host replaces agent/model/variant with Michael and this lead turn's actual model/effort. Omit paths/baseRevision unless coding; coding paths must be safe relative paths, and omitting baseRevision captures the real commit. Keep requested acceptance checks exactly; output:nonempty checks only that a report exists, other checks require user verification. Do not wait or poll.",
      parameters: Parameters,
      jsonSchema,
      execute: Effect.fn("TaskDispatchV1.execute")(function* (input: typeof Parameters.Type, context: Context) {
        if (input.brief.execution.engine !== "v1")
          return yield* Effect.die(
            new TaskExecution.Error({ message: "The V1 dispatcher cannot switch existing chats to V2" }),
          )
        const lead = yield* MessageV2.get({ sessionID: context.sessionID, messageID: context.messageID }).pipe(
          Effect.provideService(Database.Service, database),
        )
        if (lead.info.role !== "assistant" || lead.info.agent !== context.agent)
          return yield* Effect.die(new TaskExecution.Error({ message: "Dispatch requires the owning lead turn" }))
        const execution = {
          ...input.brief.execution,
          agent: "michael",
          model: {
            id: lead.info.modelID,
            providerID: lead.info.providerID,
            variant: lead.info.variant ?? "default",
          },
        }
        yield* context.ask({
          permission: "task_dispatch",
          patterns: [input.brief.title],
          always: [],
          metadata: { scope: [...input.brief.scope], execution },
        })
        yield* tasks.prepare(context.sessionID, "v1")
        const policy = yield* tasks.capture(context.sessionID, execution)
        const task = yield* tasks.dispatch({
          ...input,
          brief: { ...input.brief, execution: policy },
          ownerSessionID: context.sessionID,
        })
        return {
          title: input.brief.title,
          metadata: { taskID: task.id, ownerSessionID: task.ownerSessionID, status: task.status },
          output: JSON.stringify({ taskID: task.id, status: task.status }),
        }
      }, Effect.orDie),
    }
  }),
)

export * as TaskDispatchV1 from "./dispatch-v1"
