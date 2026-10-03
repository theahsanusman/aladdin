export * as TaskReplacements from "./replacements"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LLM } from "../session/llm"
import { Permission } from "../permission"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { InstanceStore } from "../project/instance-store"
import { Format } from "../format"
import { LSP } from "../lsp/lsp"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { Plugin } from "../plugin"
import { TaskWorkerGuards } from "./worker-guards"
import { TaskWorkerPermissionGuards } from "./permission-guards"
import { TaskWorkerBootstrap } from "./bootstrap"
import { TaskCodingServices } from "./coding-services"

export const values: LayerNode.Replacements = [
  [LLM.node, TaskWorkerGuards.v1Node],
  [LayerNodePlatform.llmClient, TaskWorkerGuards.v2Node],
  [LayerNodePlatform.httpClient, TaskWorkerGuards.httpNode],
  [Permission.node, TaskWorkerPermissionGuards.v1Node],
  [PermissionV2.node, TaskWorkerPermissionGuards.v2Node],
  [InstanceStore.node, TaskWorkerBootstrap.instanceNode],
  [Format.node, TaskCodingServices.formatNode],
  [LSP.node, TaskCodingServices.lspNode],
  [Config.node, TaskCodingServices.configNode],
  [Provider.node, TaskCodingServices.providerNode],
  [Plugin.node, TaskCodingServices.pluginNode],
]
