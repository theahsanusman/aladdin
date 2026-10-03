import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { InstanceState } from "../effect/instance-state"
import { Format } from "../format"
import { LSP } from "../lsp/lsp"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { Plugin } from "../plugin"
import { InstanceRef } from "../effect/instance-ref"

// Native file tools may launch formatter/LSP commands implicitly. Those cannot
// be allowed to execute model-edited project configuration outside an explicit
// host check. Disable them only in task-owned isolated coding Instances, without
// changing ordinary root chats or introducing another file-tool representation.
const rawFormat = { ...Format.node, name: "task/raw-format" }
export const formatNode = LayerNode.make({
  service: Format.Service,
  deps: [rawFormat, TaskExecution.node],
  layer: Layer.effect(
    Format.Service,
    Effect.gen(function* () {
      const format = yield* Format.Service
      const tasks = yield* TaskExecution.Service
      tasks.installCodingServiceGuard("format")
      const isolated = InstanceState.directory.pipe(Effect.flatMap(tasks.isWorkspace))
      return {
        ...format,
        init: () => isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.void : format.init()))),
        status: () => isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.succeed([]) : format.status()))),
        file: (file) => isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.succeed(false) : format.file(file)))),
      } satisfies Format.Interface
    }),
  ),
})

const rawLSP = { ...LSP.node, name: "task/raw-lsp" }
export const lspNode = LayerNode.make({
  service: LSP.Service,
  deps: [rawLSP, TaskExecution.node],
  layer: Layer.effect(
    LSP.Service,
    Effect.gen(function* () {
      const lsp = yield* LSP.Service
      const tasks = yield* TaskExecution.Service
      tasks.installCodingServiceGuard("lsp")
      const isolated = InstanceState.directory.pipe(Effect.flatMap(tasks.isWorkspace))
      return {
        ...lsp,
        init: () => isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.void : lsp.init()))),
        status: () => isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.succeed([]) : lsp.status()))),
        hasClients: (file) =>
          isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.succeed(false) : lsp.hasClients(file)))),
        touchFile: (file, diagnostics) =>
          isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.void : lsp.touchFile(file, diagnostics)))),
        diagnostics: () => isolated.pipe(Effect.flatMap((worker) => (worker ? Effect.succeed({}) : lsp.diagnostics()))),
      } satisfies LSP.Interface
    }),
  ),
})

function ownerContext<A, E, R>(tasks: TaskExecution.Interface, effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const owner = yield* tasks.workspaceRoot(instance.directory).pipe(Effect.orDie)
    if (!owner) return yield* effect
    if (owner.projectID !== instance.project.id) return yield* Effect.die("Isolated control context belongs to a different project")
    // Credentials/configuration stay in the existing owner's host context; no
    // private repository config is copied into a model-visible checkout.
    return yield* effect.pipe(Effect.provideService(InstanceRef, { ...instance, directory: owner.directory, worktree: owner.directory }))
  })
}

const rawConfig = { ...Config.node, name: "task/raw-config" }
export const configNode = LayerNode.make({ service: Config.Service, deps: [rawConfig, TaskExecution.node], layer: Layer.effect(Config.Service, Effect.gen(function* () {
  const config = yield* Config.Service
  const tasks = yield* TaskExecution.Service
  return { ...config, get: () => ownerContext(tasks, config.get()), directories: () => InstanceState.directory.pipe(Effect.flatMap(tasks.isWorkspace), Effect.flatMap((worker) => worker ? Effect.succeed([]) : config.directories())), waitForDependencies: () => ownerContext(tasks, config.waitForDependencies()) } satisfies Config.Interface
})) })

const rawProvider = { ...Provider.node, name: "task/raw-provider" }
export const providerNode = LayerNode.make({ service: Provider.Service, deps: [rawProvider, TaskExecution.node], layer: Layer.effect(Provider.Service, Effect.gen(function* () {
  const provider = yield* Provider.Service
  const tasks = yield* TaskExecution.Service
  return { ...provider, getModel: (...input) => ownerContext(tasks, provider.getModel(...input)), getLanguage: (...input) => ownerContext(tasks, provider.getLanguage(...input)) } satisfies Provider.Interface
})) })

const rawPlugin = { ...Plugin.node, name: "task/raw-plugin" }
export const pluginNode = LayerNode.make({ service: Plugin.Service, deps: [rawPlugin, TaskExecution.node], layer: Layer.effect(Plugin.Service, Effect.gen(function* () {
  const plugin = yield* Plugin.Service
  const tasks = yield* TaskExecution.Service
  const isolated = InstanceState.directory.pipe(Effect.flatMap(tasks.isWorkspace))
  return { ...plugin, init: () => isolated.pipe(Effect.flatMap((worker) => worker ? Effect.void : plugin.init())), list: () => isolated.pipe(Effect.flatMap((worker) => worker ? Effect.succeed([]) : plugin.list())), trigger: (name, input, output) => isolated.pipe(Effect.flatMap((worker) => worker ? Effect.succeed(output) : plugin.trigger(name, input, output))) } satisfies Plugin.Interface
})) })

export * as TaskCodingServices from "./coding-services"
