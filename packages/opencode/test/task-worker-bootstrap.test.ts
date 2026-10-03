import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { LLMClient } from "@opencode-ai/llm"
import { LLM } from "../src/session/llm"
import { TaskWorkerGuards } from "../src/task/worker-guards"
import { testEffect } from "./lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([LLM.node, LayerNodePlatform.llmClient, TaskExecution.node]), [
    [LLM.node, TaskWorkerGuards.v1Node],
    [LayerNodePlatform.llmClient, TaskWorkerGuards.v2Node],
  ]),
)
it.live("late driver bootstrap constructs both real decorated provider services without a layer cycle", () =>
  Effect.gen(function* () {
    const tasks = yield* TaskExecution.Service
    yield* tasks.requireGuard("v1")
    yield* tasks.requireGuard("v2")
    const legacy = yield* LLM.Service
    const native = yield* LLMClient.Service
    expect(typeof legacy.stream).toBe("function")
    expect(typeof native.stream).toBe("function")
  }),
)
