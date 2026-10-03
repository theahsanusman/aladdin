import { Effect, FileSystem, Layer } from "effect"
import { Permission } from "../permission"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskWorkerPolicy } from "@opencode-ai/core/task/worker-policy"
import { SessionID } from "@opencode-ai/schema/session-id"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"

export const assert = Effect.fn("TaskWorkerPermissionGuards.assert")(function* (
  tasks: TaskExecution.Interface,
  sessionID: SessionID,
  action: string,
  resources: readonly string[],
  metadata?: { readonly [key: string]: unknown },
) {
  const worker = yield* tasks.workerContext(sessionID)
  if (!worker) return
  if (worker.execution.mode === "native")
    return yield* TaskWorkerPolicy.assert(worker.execution, worker.directory, action, metadata)
  if (action === "task_integrate" && worker.execution.mode === "coding") return
  if (action === "external_directory")
    return yield* new TaskExecution.Error({
      message: "Worker external-directory escalation is outside accepted immutable scope",
    })
  const file = metadata?.filepath ?? metadata?.filePath ?? metadata?.path
  const target =
    action === "glob" || action === "grep"
      ? typeof file === "string"
        ? file
        : "."
      : typeof file === "string"
        ? file
        : resources[0]
  yield* TaskWorkerPolicy.assert(
    worker.execution,
    worker.directory,
    action,
    action === "question" ? {} : { path: target },
  )
})

const rawV1 = { ...Permission.node, name: "task/raw-v1-permission" }
export const v1Node = LayerNode.make({
  service: Permission.Service,
  deps: [rawV1, TaskExecution.node, LayerNodePlatform.filesystem],
  layer: Layer.effect(
    Permission.Service,
    Effect.gen(function* () {
      const permissions = yield* Permission.Service
      const tasks = yield* TaskExecution.Service
      const fs = yield* FileSystem.FileSystem
      tasks.installPermissionGuard("v1")
      return {
        ...permissions,
        ask: (input) =>
          assert(tasks, input.sessionID, input.permission, input.patterns, input.metadata).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.orDie,
            Effect.andThen(permissions.ask(input)),
          ),
      } satisfies Permission.Interface
    }),
  ),
})

const rawV2 = { ...PermissionV2.node, name: "task/raw-v2-permission" }
export const v2Node = makeLocationNode({
  service: PermissionV2.Service,
  deps: [rawV2, TaskExecution.node, LayerNodePlatform.filesystem],
  layer: Layer.effect(
    PermissionV2.Service,
    Effect.gen(function* () {
      const permissions = yield* PermissionV2.Service
      const tasks = yield* TaskExecution.Service
      const fs = yield* FileSystem.FileSystem
      tasks.installPermissionGuard("v2")
      const check = (input: PermissionV2.AssertInput) =>
        assert(tasks, input.sessionID, input.action, input.resources, input.metadata).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.orDie,
        )
      return {
        ...permissions,
        ask: (input) =>
          check(input).pipe(
            Effect.andThen(permissions.ask({ ...input, save: input.save ?? [], metadata: input.metadata ?? {} })),
          ),
        assert: (input) =>
          check(input).pipe(
            Effect.andThen(permissions.assert({ ...input, save: input.save ?? [], metadata: input.metadata ?? {} })),
          ),
      } satisfies PermissionV2.Interface
    }),
  ),
})

export * as TaskWorkerPermissionGuards from "./permission-guards"
