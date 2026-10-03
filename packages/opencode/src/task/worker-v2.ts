import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { AgentV2 } from "@opencode-ai/core/agent"
import { TaskWorkerIntent } from "@opencode-ai/core/task/worker-intent"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { Task } from "@opencode-ai/schema/task"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Claim } from "@/claim/registry"

export type Verify = (task: Task.Info, output: string) => Effect.Effect<TaskExecution.Result["checks"], unknown>

/** Evaluate once under the owning Location's services in the application scope.
 * SessionExecution is late-captured, keeping TaskExecution out of its layer graph. */
export const make = Effect.fn("TaskWorkerV2.make")(function* (directory: AbsolutePath, verify: Verify) {
  const tasks = yield* TaskExecution.Service
  yield* tasks.requireGuard("v2")
  yield* tasks.requireNetworkGuard()
  const database = yield* Database.Service
  const events = yield* EventV2.Service
  const store = yield* SessionStore.Service
  const execution = yield* SessionExecution.Service
  const models = yield* SessionRunnerModel.Service
  const agents = yield* AgentV2.Service
  return {
    engine: "v2",
    directory,
    run: Effect.fn("TaskWorkerV2.run")(function* (task, attempt) {
      yield* tasks.requireGuard("v2")
      const policy = task.brief.execution
      if (policy && policy.mode !== "report") yield* tasks.requirePermissionGuard("v2")
      if (policy?.mode === "coding" && (yield* tasks.workerContext(attempt.workerSessionID))?.directory !== directory)
        return yield* new TaskExecution.Error({ message: "Coding driver requires a bound isolated workspace" })
      if (
        !policy ||
        policy.engine !== "v2" ||
        task.location.directory !== directory ||
        task.location.workspaceID !== undefined
      )
        return yield* new TaskExecution.Error({ message: "Unsupported worker placement or engine" })
      if (!(yield* agents.get(AgentV2.ID.make(policy.agent))))
        return yield* new TaskExecution.Error({ message: `Selected worker agent unavailable: ${policy.agent}` })
      const session = yield* TaskWorkerIntent.create({ database, events, store }, task, attempt)
      // Resolves the explicitly recorded model. Never chooses a default/fallback.
      const selected = yield* models.resolve(session)
      yield* tasks.bindModel(attempt, { id: selected.id, providerID: selected.provider })
      yield* TaskWorkerIntent.admit({ database, events, store }, task, attempt)
      // Explicit resume joins the existing serialized drain and propagates errors;
      // advisory wake alone cannot report completion. No legacy loop is involved.
      // File claims are per-turn state in a process-global registry; this path
      // bypasses SessionPrompt.prompt, so release them when the drain finishes.
      yield* execution
        .resume(attempt.workerSessionID)
        .pipe(Effect.ensuring(Effect.sync(() => Claim.releaseSession(attempt.workerSessionID))))
      const history = yield* store.context(attempt.workerSessionID)
      const last = history.findLast((message) => message.type === "assistant")
      if (!last || last.type !== "assistant" || last.error)
        return yield* new TaskExecution.Error({ message: "Worker has no successful durable assistant result" })
      const output = last.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      if (output.length > 8_000)
        return yield* new TaskExecution.Error({
          message: "Worker output exceeds compact handoff limit; use artifact references",
        })
      return { summary: output, checks: [] }
    }),
    verify: (task, result) => verify(task, result.summary).pipe(Effect.map((checks) => ({ ...result, checks }))),
    cleanup: Effect.fn("TaskWorkerV2.cleanup")(function* (attempt) {
      yield* execution.interrupt(attempt.workerSessionID)
      if ((yield* execution.active).has(attempt.workerSessionID))
        return yield* new TaskExecution.Error({ message: "Worker Session remains active after interruption" })
      return "SessionExecution joined worker and native tool cleanup; recursive workers were disabled"
    }),
  } satisfies TaskExecution.Driver
})

export * as TaskWorkerV2 from "./worker-v2"
