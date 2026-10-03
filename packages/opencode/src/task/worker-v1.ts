import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionStore } from "@opencode-ai/core/session/store"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { TaskWorkerIntent } from "@opencode-ai/core/task/worker-intent"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { InstanceRef } from "../effect/instance-ref"
import { InstanceState } from "../effect/instance-state"
import { Session } from "../session/session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import type { TaskWorkerV2 } from "./worker-v2"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Claim } from "@/claim/registry"

/** V1 remains V1: durable legacy user message plus its existing native loop.
 * Capture the actual owning Instance, never a process default directory. */
export const make = Effect.fn("TaskWorkerV1.make")(function* (verify: TaskWorkerV2.Verify) {
  const tasks = yield* TaskExecution.Service
  yield* tasks.requireGuard("v1")
  yield* tasks.requireNetworkGuard()
  const instance = yield* InstanceState.context
  const directory = AbsolutePath.make(instance.directory)
  const database = yield* Database.Service
  const events = yield* EventV2.Service
  const store = yield* SessionStore.Service
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const agents = yield* Agent.Service
  const providers = yield* Provider.Service
  return {
    engine: "v1",
    directory,
    run: Effect.fn("TaskWorkerV1.run")(
      function* (task, attempt) {
        const policy = task.brief.execution
        if (policy && policy.mode !== "report") yield* tasks.requirePermissionGuard("v1")
        if (policy?.mode === "coding") yield* tasks.requireCodingServiceGuards()
        if (policy?.mode === "coding" && (yield* tasks.workerContext(attempt.workerSessionID))?.directory !== directory)
          return yield* new TaskExecution.Error({ message: "Coding driver requires a bound isolated workspace" })
        if (
          !policy ||
          policy.engine !== "v1" ||
          task.projectID !== instance.project.id ||
          task.location.directory !== directory ||
          task.location.workspaceID !== undefined
        )
          return yield* new TaskExecution.Error({ message: "Worker must execute inside its owning local Instance" })
        if (!(yield* agents.get(policy.agent)))
          return yield* new TaskExecution.Error({ message: `Selected worker agent unavailable: ${policy.agent}` })
        const model = yield* providers.getModel(
          ProviderV2.ID.make(policy.model.providerID),
          ModelV2.ID.make(policy.model.id),
        )
        if (policy.model.variant && policy.model.variant !== "default" && !model.variants?.[policy.model.variant])
          return yield* new TaskExecution.Error({
            message: `Selected worker model variant unavailable: ${policy.model.variant}`,
          })
        yield* TaskWorkerIntent.create({ database, events, store }, task, attempt)
        const worker = yield* sessions.get(attempt.workerSessionID)
        if (worker.parentID !== task.ownerSessionID || worker.directory !== directory)
          return yield* new TaskExecution.Error({ message: "Legacy worker ownership mismatch" })
        const text = TaskWorkerIntent.prompt(task, attempt).text
        const existing = yield* database.db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.id, MessageID.make(attempt.inputMessageID)))
          .get()
        if (existing && existing.session_id !== attempt.workerSessionID)
          return yield* new TaskExecution.Error({ message: "Legacy input ID belongs to another Session" })
        if (existing) {
          const saved = yield* MessageV2.get({
            sessionID: attempt.workerSessionID,
            messageID: MessageID.make(attempt.inputMessageID),
          }).pipe(Effect.provideService(Database.Service, database))
          if (
            saved.info.role !== "user" ||
            saved.info.agent !== policy.agent ||
            saved.info.model.modelID !== policy.model.id ||
            saved.info.model.providerID !== policy.model.providerID ||
            (saved.info.model.variant ?? "default") !== (policy.model.variant ?? "default") ||
            saved.parts.length !== 1 ||
            saved.parts[0]?.type !== "text" ||
            saved.parts[0].text !== text
          )
            return yield* new TaskExecution.Error({
              message: "Legacy input identity conflicts with immutable worker brief",
            })
        }
        if (!existing)
          yield* prompt.prompt({
            sessionID: attempt.workerSessionID,
            messageID: MessageID.make(attempt.inputMessageID),
            agent: policy.agent,
            model: {
              modelID: ModelV2.ID.make(policy.model.id),
              providerID: ProviderV2.ID.make(policy.model.providerID),
            },
            variant: policy.model.variant ?? "default",
            noReply: true,
            parts: [{ type: "text", text }],
          })
        // This bypasses SessionPrompt.prompt, so it must own the same file-claim
        // lifetime the prompt path guarantees; otherwise claims linger for TTL.
        const result = yield* prompt
          .loop({ sessionID: attempt.workerSessionID })
          .pipe(Effect.ensuring(Effect.sync(() => Claim.releaseSession(attempt.workerSessionID))))
        if (result.info.role !== "assistant" || result.info.error)
          return yield* new TaskExecution.Error({ message: "Legacy worker failed; inspect its native transcript" })
        const output = result.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        if (output.length > 8_000)
          return yield* new TaskExecution.Error({
            message: "Worker output exceeds compact handoff limit; use artifact references",
          })
        return { summary: output, checks: [] }
      },
      Effect.provideService(InstanceRef, instance),
    ),
    verify: (task, result) =>
      verify(task, result.summary).pipe(
        Effect.map((checks) => ({ ...result, checks })),
        Effect.provideService(InstanceRef, instance),
      ),
    cleanup: Effect.fn("TaskWorkerV1.cleanup")((attempt) =>
      prompt
        .cancel(attempt.workerSessionID)
        .pipe(
          Effect.as("Legacy Session cancellation joined native tool cleanup; recursive workers were disabled"),
          Effect.provideService(InstanceRef, instance),
        ),
    ),
  } satisfies TaskExecution.Driver
})

export * as TaskWorkerV1 from "./worker-v1"
