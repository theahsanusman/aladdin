import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { Task } from "@opencode-ai/schema/task"
import { InstanceStore } from "../project/instance-store"
import { InstanceRef } from "../effect/instance-ref"
import { InstanceState } from "../effect/instance-state"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Permission } from "../permission"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AgentV2 } from "@opencode-ai/core/agent"
import { TaskCodingDriver } from "./coding-driver"
import { TaskWorkerV1 } from "./worker-v1"
import { TaskWorkerV2 } from "./worker-v2"
import { TaskWorkspace } from "./workspace"
import { FSUtil } from "@opencode-ai/core/fs-util"

type CodingChecks = (
  workspace: TaskWorkspace.Workspace,
  artifact: TaskWorkspace.Artifact,
  task: Task.Info,
) => Effect.Effect<TaskExecution.Result["checks"], unknown>
type Requirements<T> = T extends Effect.Effect<unknown, unknown, infer R> ? R : never

function combine(ordinary: TaskExecution.Driver, coding: TaskExecution.Driver): TaskExecution.Driver {
  const mutation = new Set<Task.AttemptID>()
  return {
    ...ordinary,
    run: (task, attempt, budget) => {
      if (task.brief.execution?.mode !== "coding") return ordinary.run(task, attempt, budget)
      mutation.add(attempt.id)
      return coding.run(task, attempt, budget)
    },
    verify: (task, result, attempt) =>
      task.brief.execution?.mode === "coding"
        ? coding.verify
          ? coding.verify(task, result, attempt)
          : Effect.die("Missing coding verifier")
        : ordinary.verify
          ? ordinary.verify(task, result, attempt)
          : Effect.succeed(result),
    cleanup: (attempt) =>
      mutation.has(attempt.id)
        ? coding.cleanup(attempt).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                mutation.delete(attempt.id)
              }),
            ),
          )
        : ordinary.cleanup(attempt),
  }
}

/** Call under the actual root InstanceRef in app-global bootstrap. All ordinary
 * work and isolated coding work share one registered driver and durable team. */
export const v1 = Effect.fn("TaskWorkerBootstrap.v1")(function* (input: {
  storage: string
  verify: TaskWorkerV2.Verify
  codingChecks: CodingChecks
}) {
  const tasks = yield* TaskExecution.Service
  const instance = yield* InstanceState.context
  const instances = yield* InstanceStore.Service
  const permissions = yield* Permission.Service
  const ordinary = yield* TaskWorkerV1.make(input.verify)
  const context = yield* Effect.context<Requirements<ReturnType<typeof TaskWorkerV1.make>>>()
  const coding = yield* TaskCodingDriver.make({
    engine: "v1",
    root: AbsolutePath.make(instance.directory),
    storage: input.storage,
    open: (directory) =>
      Effect.gen(function* () {
        const worker = yield* instances.load({ directory })
        return yield* TaskWorkerV1.make(input.verify).pipe(
          Effect.provideService(InstanceRef, worker),
          Effect.provide(context),
        )
      }),
    verify: input.codingChecks,
    close: (directory) => instances.disposeDirectory(directory),
    authorize: (task, attempt, artifact) =>
      Effect.gen(function* () {
        const context = yield* tasks.workerContext(attempt.workerSessionID)
        if (!context)
          return yield* new TaskExecution.Error({ message: "Worker ownership lost before native integration request" })
        const worker = yield* instances.load({ directory: context.directory })
        yield* permissions
          .ask({
            sessionID: attempt.workerSessionID,
            permission: "task_integrate",
            patterns: [task.location.directory, artifact.digest],
            always: [],
            metadata: {
              taskID: task.id,
              attemptID: attempt.id,
              patchDigest: artifact.digest,
              files: [...artifact.files],
              target: task.location.directory,
            },
            ruleset: [{ permission: "task_integrate", pattern: "*", action: "ask" }],
          })
          .pipe(Effect.provideService(InstanceRef, worker))
      }),
  }).pipe(tasks.inHostScope)
  yield* tasks.register(combine(ordinary, coding))
})

export const v2 = Effect.fn("TaskWorkerBootstrap.v2")(function* (input: {
  directory: AbsolutePath
  storage: string
  verify: TaskWorkerV2.Verify
  codingChecks: CodingChecks
}) {
  const tasks = yield* TaskExecution.Service
  const locations = yield* LocationServiceMap.Service
  const ordinary = yield* TaskWorkerV2.make(input.directory, input.verify)
  const context = yield* Effect.context<Requirements<ReturnType<typeof TaskWorkerV2.make>>>()
  const coding = yield* TaskCodingDriver.make({
    engine: "v2",
    root: input.directory,
    storage: input.storage,
    open: (directory) =>
      TaskWorkerV2.make(directory, input.verify).pipe(
        Effect.provide(locations.get({ directory })),
        Effect.provide(context),
      ),
    verify: input.codingChecks,
    close: (directory) => locations.invalidate({ directory }),
    authorize: (task, attempt, artifact) =>
      Effect.gen(function* () {
        const worker = yield* tasks.workerContext(attempt.workerSessionID)
        if (!worker)
          return yield* new TaskExecution.Error({ message: "Worker ownership lost before native integration request" })
        yield* PermissionV2.Service.use((permission) =>
          permission.assert({
            sessionID: attempt.workerSessionID,
            agent: AgentV2.ID.make(task.brief.execution?.agent ?? ""),
            action: "task_integrate",
            resources: [task.location.directory, artifact.digest],
            save: [],
            metadata: {
              taskID: task.id,
              attemptID: attempt.id,
              patchDigest: artifact.digest,
              files: [...artifact.files],
              target: task.location.directory,
            },
          }),
        ).pipe(Effect.provide(locations.get({ directory: worker.directory })))
      }),
  }).pipe(tasks.inHostScope)
  yield* tasks.register(combine(ordinary, coding))
})

// Install with the provider guards: explicit project/view disposal cannot tear
// down a counted worker's Instance. Full host shutdown must interrupt tasks first.
const rawInstances = { ...InstanceStore.node, name: "task/raw-instance-store" }
export const instanceNode = makeGlobalNode({
  service: InstanceStore.Service,
  deps: [rawInstances, TaskExecution.node],
  layer: Layer.effect(
    InstanceStore.Service,
    Effect.gen(function* () {
      const instances = yield* InstanceStore.Service
      const tasks = yield* TaskExecution.Service
      const check = (directory: string) =>
        tasks.pinned(FSUtil.resolve(directory)).pipe(
          Effect.orDie,
          Effect.flatMap((pinned) =>
            pinned
              ? Effect.die(
                  new TaskExecution.Error({
                    message: "Instance has durable worker ownership; cancel/reconcile tasks before disposal",
                  }),
                )
              : Effect.void,
          ),
        )
      return {
        ...instances,
        dispose: (ctx) =>
          check(ctx.directory).pipe(
            Effect.andThen(tasks.reload(instances.dispose(ctx), FSUtil.resolve(ctx.directory)).pipe(Effect.orDie)),
          ),
        disposeDirectory: (directory) =>
          check(directory).pipe(
            Effect.andThen(
              tasks.reload(instances.disposeDirectory(directory), FSUtil.resolve(directory)).pipe(Effect.orDie),
            ),
          ),
        reload: (input) =>
          check(input.directory).pipe(
            Effect.andThen(tasks.reload(instances.reload(input), FSUtil.resolve(input.directory)).pipe(Effect.orDie)),
          ),
        disposeAll: () => tasks.reload(instances.disposeAll()).pipe(Effect.orDie),
      } satisfies InstanceStore.Interface
    }),
  ),
})

export * as TaskWorkerBootstrap from "./bootstrap"
