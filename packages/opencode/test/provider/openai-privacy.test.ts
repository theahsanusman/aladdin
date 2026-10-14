import { afterEach, expect } from "bun:test"
import { generateText, streamText } from "ai"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "@/provider/provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { testProviderConfig } from "../lib/test-provider"

afterEach(disposeAllInstances)
const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, CrossSpawnSpawner.node])))

for (const npm of ["@ai-sdk/openai", "@ai-sdk/openai-compatible"]) {
  it.live(`OpenAI ${npm} forces store=false on SDK streaming and non-streaming calls`, () =>
    Effect.gen(function* () {
      const bodies: unknown[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
          bodies.push(await request.json())
          return Response.json({ error: { message: "captured" } }, { status: 400 })
        } })),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const base = testProviderConfig(`http://127.0.0.1:${server.port}/v1`)
      yield* provideTmpdirInstance(() => Effect.gen(function* () {
        const provider = yield* Provider.Service
        const model = yield* provider.getModel(ProviderV2.ID.openai, ModelV2.ID.make("test-model"))
        const options = { model: yield* provider.getLanguage(model), prompt: "privacy test", providerOptions: { openai: { store: true } }, maxRetries: 0 }
        yield* Effect.promise(() => generateText(options).then(() => undefined, () => undefined))
        yield* Effect.promise(() => streamText({ ...options, onError() {} }).consumeStream())
        expect(bodies).toHaveLength(2)
        bodies.forEach((body) => expect(body).toMatchObject({ model: "test-model", store: false }))
        if (npm === "@ai-sdk/openai") bodies.forEach((body) => expect(body).toMatchObject({ include: ["reasoning.encrypted_content"] }))
      }), { config: { formatter: false, lsp: false, enabled_providers: ["openai"], provider: { openai: {
        ...base.provider.test,
        id: "openai",
        npm,
        options: { ...base.provider.test.options, store: true },
        models: { "test-model": { ...base.provider.test.models["test-model"], options: { store: true } } },
      } } } })
    }),
  )
}
