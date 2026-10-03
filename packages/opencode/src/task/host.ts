export * as TaskHost from "./host"

import { Effect, FileSystem, Layer, SynchronizedRef } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Task } from "@opencode-ai/schema/task"
import { InstanceStore } from "../project/instance-store"
import { InstanceRef } from "../effect/instance-ref"
import { Session } from "../session/session"
import { SessionPrompt } from "../session/prompt"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Permission } from "../permission"
import { Question } from "../question"
import { TaskWorkerBootstrap } from "./bootstrap"
import { TaskWorkspace } from "./workspace"

type Requirements<T> = T extends Effect.Effect<unknown, unknown, infer R> ? R : never

export const node = makeGlobalNode({
  name: "task/host",
  deps: [
    Database.node,
    TaskExecution.node,
    TaskLedger.node,
    SessionStore.node,
    EventV2.node,
    InstanceStore.node,
    Session.node,
    SessionPrompt.node,
    Agent.node,
    Provider.node,
    Permission.node,
    Question.node,
    LayerNodePlatform.filesystem,
  ],
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const execution = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const sessions = yield* SessionStore.Service
      const instances = yield* InstanceStore.Service
      const questions = yield* Question.Service
      const permissions = yield* Permission.Service
      const fs = yield* FileSystem.FileSystem
      const context = yield* Effect.context<Requirements<ReturnType<typeof TaskWorkerBootstrap.v1>>>()
      const registrations = yield* SynchronizedRef.make(new Map<string, Effect.Effect<void, unknown>>())
      const storage = `${Global.Path.data}/task-workspaces`
      yield* execution.attachRepository("v1", (owner) =>
        Effect.gen(function* () {
          const root = yield* sessions.get(owner)
          if (!root || root.parentID)
            return yield* new TaskExecution.Error({ message: "Repository capture requires an existing root chat" })
          return yield* TaskWorkspace.revision(root.location.directory)
        }),
      )

      yield* execution
        .attachDelivery("v1", (interaction, decision) =>
          Effect.gen(function* () {
            const worker = yield* sessions.get(interaction.workerSessionID)
            if (!worker || worker.parentID !== interaction.ownerSessionID)
              return yield* new TaskExecution.Error({ message: "Native request lost its worker ownership" })
            const instance = yield* instances.load({ directory: worker.location.directory })
            const deliver = Effect.gen(function* () {
              if (interaction.kind === "question") {
                const request = (yield* questions.list()).find(
                  (request) =>
                    request.id === interaction.requestID && request.sessionID === interaction.workerSessionID,
                )
                if (!request)
                  return yield* new TaskExecution.Error({
                    message:
                      "Question has no live safe continuation; interrupted work must be reconciled before answering",
                  })
                if (decision.kind === "question")
                  return yield* questions.reply({ requestID: request.id, answers: decision.answers })
                if (decision.kind === "question-rejection") return yield* questions.reject(request.id)
                return yield* new TaskExecution.Error({ message: "Decision kind does not match the native question" })
              }
              const request = (yield* permissions.list()).find(
                (request) => request.id === interaction.requestID && request.sessionID === interaction.workerSessionID,
              )
              if (!request || decision.kind !== "permission")
                return yield* new TaskExecution.Error({
                  message: "Permission has no live safe continuation or has a mismatched decision",
                })
              yield* permissions.reply({
                requestID: request.id,
                reply: decision.reply,
                ...(decision.message === undefined ? {} : { message: decision.message }),
                ...(decision.automatic === undefined ? {} : { automatic: decision.automatic }),
              })
            })
            yield* deliver.pipe(Effect.provideService(InstanceRef, instance))
          }),
        )
        .pipe(Effect.orDie)

      const verify = Effect.fn("TaskHost.verify")(function* (task: Task.Info, output: string) {
        if (!output.trim())
          return task.brief.checks.map((check) => ({ check, passed: false, evidence: "Worker returned no report" }))
        const details = yield* ledger.details({ ownerSessionID: task.ownerSessionID, taskID: task.id })
        if (!details.attempt) return yield* new TaskExecution.Error({ message: "Verification lost its worker attempt" })
        const worker = yield* sessions.get(details.attempt.workerSessionID)
        if (!worker) return yield* new TaskExecution.Error({ message: "Verification lost its worker Session" })
        const instance = yield* instances.load({ directory: worker.location.directory })
        const pending = task.brief.checks.filter((check) => check !== "output:nonempty")
        const answers = pending.length
          ? yield* questions
              .ask({
                sessionID: worker.id,
                questions: pending.map((check) => ({
                  header: "Verify",
                  question: `Verify this acceptance check against the worker's report and artifacts: ${check}\n\nWorker report:\n${output}`,
                  options: [
                    { label: "Passed", description: "I independently checked this requirement" },
                    { label: "Failed", description: "This requirement is not satisfied" },
                  ],
                  custom: false,
                })),
              })
              .pipe(Effect.provideService(InstanceRef, instance))
          : undefined
        return task.brief.checks.map((check) => {
          if (check === "output:nonempty")
            return { check, passed: true, evidence: `Host inspected a nonempty ${output.length}-character report` }
          const index = pending.indexOf(check)
          return {
            check,
            passed:
              answers?.source === "user" &&
              answers.answers[index]?.length === 1 &&
              answers.answers[index]?.[0] === "Passed",
            evidence: "Explicit native human verification; worker assertions are not treated as test evidence",
          }
        })
      })

      yield* execution
        .attachHost("v1", (owner: SessionID) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(owner)
            if (!session || session.parentID)
              return yield* new TaskExecution.Error({ message: "Worker teams belong to existing root chats" })
            if (yield* execution.hasDriver("v1", session.location.directory)) return
            const registered = yield* SynchronizedRef.modifyEffect(registrations, (current) => {
              const key = `${execution.generation()}:${session.location.directory}`
              const existing = current.get(key)
              if (existing) return Effect.succeed([existing, current] as const)
              return Effect.cached(
                Effect.gen(function* () {
                  yield* fs.makeDirectory(storage, { recursive: true })
                  const instance = yield* instances.load({ directory: session.location.directory })
                  yield* TaskWorkerBootstrap.v1({
                    storage,
                    verify,
                    codingChecks: (workspace, artifact, task) =>
                      verify(
                        task,
                        `Patch ${artifact.digest}; changed files: ${artifact.files.join(", ")}\nFull patch: ${workspace.directory}.patch\n\nPatch preview:\n${artifact.patch.slice(0, 4_000)}`,
                      ),
                  }).pipe(Effect.provideService(InstanceRef, instance), Effect.provide(context), execution.inHostScope)
                }),
              ).pipe(Effect.map((entry) => [entry, new Map(current).set(key, entry)] as const))
            })
            yield* registered
          }),
        )
        .pipe(Effect.orDie)
      // Fence abandoned attempts before draining queued work in the new host.
      yield* execution.startup().pipe(Effect.orDie)
    }),
  ),
})
