import { afterEach, expect } from "bun:test"
import { APICallError, generateText, streamText } from "ai"
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

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, CrossSpawnSpawner.node])),
)

for (const npm of ["@openrouter/ai-sdk-provider", "@ai-sdk/openai-compatible", "@ai-sdk/openai"]) {
  it.live(`OpenRouter ${npm} protects streaming and non-streaming SDK requests against every body override`, () =>
    Effect.gen(function* () {
      const requests: { headers: Headers; body: unknown }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            requests.push({ headers: request.headers, body: await request.json() })
            return Response.json({ error: { code: 404, message: "No endpoints match the data policy" } }, { status: 404 })
          },
        })),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const base = testProviderConfig(`http://127.0.0.1:${server.port}/api/v1`)
      yield* provideTmpdirInstance(() => Effect.gen(function* () {
        const provider = yield* Provider.Service
        const model = yield* provider.getModel(ProviderV2.ID.openrouter, ModelV2.ID.make("test-model"))
        const language = yield* provider.getLanguage(model)
        const options = {
          model: language,
          prompt: "privacy test",
          headers: { "x-preserved": "yes" },
          providerOptions: { openrouter: { provider: { zdr: false, data_collection: "allow", order: ["preserved"] } } },
          maxRetries: 2,
        }
        const error = yield* Effect.promise(() => generateText(options).then(() => undefined, (error: unknown) => error))
        expect(APICallError.isInstance(error)).toBe(true)
        expect(APICallError.isInstance(error) && error.statusCode).toBe(404)
        const stream = streamText({ ...options, onError() {} })
        yield* Effect.promise(() => stream.consumeStream())
        expect(requests).toHaveLength(2)
        for (const request of requests) {
          expect(request.body).toMatchObject({ model: "test-model", provider: { zdr: true, data_collection: "deny" } })
          expect(request.headers.get("authorization")).toBe("Bearer test-key")
          expect(request.headers.get("x-preserved")).toBe("yes")
        }
      }), { config: {
        formatter: false,
        lsp: false,
        enabled_providers: ["openrouter"],
        provider: { openrouter: {
          ...base.provider.test,
          id: "openrouter",
          npm,
          options: { ...base.provider.test.options, extraBody: { provider: { zdr: false, data_collection: "allow" } } },
          models: { "test-model": { ...base.provider.test.models["test-model"], options: {
            provider: { zdr: false, data_collection: "allow" },
            extraBody: { provider: { zdr: false, data_collection: "allow" } },
          } } },
        } },
      } })
    }),
  )
}

for (const endpoint of [
  { url: "https://eu.openrouter.ai/api/v1", provider: "alias", protected: true },
  { url: "https://api.commandcode.ai/provider/v1", provider: "openrouter", protected: false },
  { url: "https://unrelated.example/v1", provider: "alias", protected: false },
] as const) {
  it.live(`SDK endpoint detection preserves the right data policy for ${endpoint.url}`, () =>
    Effect.gen(function* () {
      const requests: { body: unknown; headers: Headers }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            requests.push({ body: await request.json(), headers: request.headers })
            return Response.json({ error: { message: "captured" } }, { status: 404 })
          },
        })),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const base = testProviderConfig(endpoint.url)
      yield* provideTmpdirInstance(() => Effect.gen(function* () {
        const provider = yield* Provider.Service
        const configured = yield* provider.getProvider(ProviderV2.ID.make(endpoint.provider))
        configured.options.fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}/capture`, init)
        const model = yield* provider.getModel(ProviderV2.ID.make(endpoint.provider), ModelV2.ID.make("test-model"))
        const stream = streamText({ model: yield* provider.getLanguage(model), prompt: "privacy test", maxRetries: 0, onError() {} })
        yield* Effect.promise(() => stream.consumeStream())
        expect(requests).toHaveLength(1)
        expect(requests[0].body).toMatchObject({ model: "test-model" })
        if (endpoint.protected) expect(requests[0].body).toMatchObject({ provider: { zdr: true, data_collection: "deny" } })
        if (!endpoint.protected) expect(requests[0].body).not.toHaveProperty("provider")
        if (endpoint.provider === "openrouter") expect(requests[0].headers.get("x-cmd-zdr")).toBe("1")
      }), { config: {
        formatter: false,
        lsp: false,
        enabled_providers: [endpoint.provider],
        provider: { [endpoint.provider]: { ...base.provider.test, id: endpoint.provider } },
      } })
    }),
  )
}
