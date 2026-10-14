import { expect } from "bun:test"
import { Effect } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginTestLayer } from "./plugin/fixture"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginTestLayer)

for (const pkg of ["@openrouter/ai-sdk-provider", "@ai-sdk/openai-compatible"]) {
  it.live(`Core ${pkg} enforces OpenRouter privacy on actual SDK requests`, () =>
    Effect.gen(function* () {
      const requests: { body: unknown; headers: Headers }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            requests.push({ body: await request.json(), headers: request.headers })
            return Response.json({ error: { code: 404, message: "No endpoints match the data policy" } }, { status: 404 })
          },
        })),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const { OpenRouterPlugin } = yield* Effect.promise(() => import("@opencode-ai/core/plugin/provider/openrouter"))
      const { OpenAICompatiblePlugin } = yield* Effect.promise(() => import("@opencode-ai/core/plugin/provider/openai-compatible"))
      yield* OpenRouterPlugin.effect(host)
      yield* OpenAICompatiblePlugin.effect(host)
      const aisdk = yield* AISDK.Service
      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.openrouter, ModelV2.ID.make("test-model")),
        api: { id: ModelV2.ID.make("test-model"), type: "aisdk", package: pkg, url: `http://127.0.0.1:${server.port}/api/v1` },
        request: { headers: {}, body: { apiKey: "test-key", extraBody: { provider: { zdr: false, data_collection: "allow", order: ["preserved"] } } } },
      })
      const language = yield* aisdk.language(model)
      const error = yield* Effect.promise(() => Promise.resolve(language.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "privacy test" }] }],
        headers: { "x-preserved": "yes" },
        providerOptions: { openrouter: { provider: { zdr: false, data_collection: "allow", order: ["preserved"] } } },
      })).then(() => undefined, (error: unknown) => error))
      expect(error).toMatchObject({ statusCode: 404 })
      expect(requests).toHaveLength(1)
      expect(requests[0].body).toMatchObject({ model: "test-model", provider: { zdr: true, data_collection: "deny" } })
      expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
      expect(requests[0].headers.get("x-preserved")).toBe("yes")
    }),
  )
}
