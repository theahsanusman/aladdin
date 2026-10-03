export * as TaskWorkerIntent from "./worker-intent"

import { Effect } from "effect"
import { Task } from "@opencode-ai/schema/task"
import { SessionV1 } from "../v1/session"
import { SessionStore } from "../session/store"
import { SessionInput } from "../session/input"
import { EventV2 } from "../event"
import { Database } from "../database/database"
import { Slug } from "../util/slug"
import { InstallationVersion } from "../installation/version"
import { TaskExecution } from "./execution"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionTable } from "../session/sql"
import { eq } from "drizzle-orm"

type Services = {
  readonly database: Database.Interface
  readonly store: SessionStore.Interface
  readonly events: EventV2.Interface
}

export function prompt(task: Task.Info, attempt: Task.Attempt) {
  return {
    text: JSON.stringify({ taskID: task.id, attemptID: attempt.id, generation: attempt.generation, brief: task.brief }),
  }
}

/** Session creation uses the existing durable Created projector in both engines.
 * This is a shared storage event, not a legacy model-execution bridge. */
export const create = Effect.fn("TaskWorkerIntent.create")(function* (
  services: Services,
  task: Task.Info,
  attempt: Task.Attempt,
) {
  const execution = task.brief.execution
  if (!execution || attempt.taskID !== task.id || attempt.ownerSessionID !== task.ownerSessionID)
    return yield* new TaskExecution.Error({ message: "Worker intent does not match its immutable task" })
  const recorded = yield* services.store.get(attempt.workerSessionID)
  if (recorded) {
    if (
      recorded.parentID !== task.ownerSessionID ||
      recorded.projectID !== task.projectID ||
      recorded.location.directory !== task.location.directory ||
      recorded.location.workspaceID !== task.location.workspaceID ||
      recorded.agent !== execution.agent ||
      recorded.model?.id !== execution.model.id ||
      recorded.model.providerID !== execution.model.providerID ||
      (recorded.model.variant ?? "default") !== (execution.model.variant ?? "default")
    )
      return yield* new TaskExecution.Error({ message: "Worker Session identity conflicts with dispatch intent" })
    return recorded
  }
  const now = Date.now()
  const owner =
    execution.mode === "native"
      ? yield* services.database.db.select().from(SessionTable).where(eq(SessionTable.id, task.ownerSessionID)).get()
      : undefined
  if (
    execution.mode === "native" &&
    (!owner ||
      owner.parent_id ||
      owner.project_id !== task.projectID ||
      owner.directory !== task.location.directory ||
      execution.agent !== "michael")
  )
    return yield* new TaskExecution.Error({ message: "Native workers require the owning root and Michael profile" })
  const info = SessionV1.SessionInfo.make({
    id: attempt.workerSessionID,
    parentID: task.ownerSessionID,
    projectID: task.projectID,
    directory: task.location.directory,
    workspaceID: task.location.workspaceID,
    slug: Slug.create(),
    version: InstallationVersion,
    title: task.brief.title,
    metadata: {
      task: { id: task.id, attemptID: attempt.id, ownerSessionID: task.ownerSessionID, generation: attempt.generation },
    },
    agent: execution.agent,
    model: {
      id: ModelV2.ID.make(execution.model.id),
      providerID: ProviderV2.ID.make(execution.model.providerID),
      variant: execution.model.variant,
    },
    // Native permission asks remain authoritative; the provider/tool boundary
    // independently restricts names and paths for the immutable worker mode.
    permission:
      execution.mode === "native"
        ? [
            ...(owner?.permission ?? []),
            ...["task", "task_dispatch", "plan_enter", "plan_exit"].map((permission) => ({
              permission,
              pattern: "*",
              action: "deny" as const,
            })),
          ]
        : [
            { permission: "*", pattern: "*", action: "deny" },
            ...(execution.agent === "michael"
              ? ["skill", "websearch", "webfetch"].map((permission) => ({
                  permission,
                  pattern: "*",
                  action: "allow" as const,
                }))
              : []),
            ...(execution.mode !== "report"
              ? ["read", "glob", "grep", "question", ...(execution.mode === "coding" ? ["edit"] : [])].map(
                  (permission) => ({
                    permission,
                    pattern: "*",
                    action: "ask" as const,
                  }),
                )
              : []),
          ],
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now, updated: now },
  })
  yield* services.events.publish(
    SessionV1.Event.Created,
    { sessionID: attempt.workerSessionID, info },
    { location: task.location },
  )
  const session = yield* services.store.get(attempt.workerSessionID)
  if (!session) return yield* Effect.die("Worker Created event was not projected")
  return session
})

export const admit = Effect.fn("TaskWorkerIntent.admit")(function* (
  services: Services,
  task: Task.Info,
  attempt: Task.Attempt,
) {
  const input = {
    id: attempt.inputMessageID,
    sessionID: attempt.workerSessionID,
    prompt: prompt(task, attempt),
    delivery: "steer" as const,
  }
  const existing = yield* SessionInput.find(services.database.db, input.id)
  if (
    existing &&
    (existing.sessionID !== input.sessionID ||
      existing.delivery !== input.delivery ||
      existing.prompt.text !== input.prompt.text)
  )
    return yield* new TaskExecution.Error({ message: "Worker input identity conflicts with dispatch intent" })
  return yield* SessionInput.admit(services.database.db, services.events, input)
})
