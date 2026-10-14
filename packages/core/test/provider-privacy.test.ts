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
for (const providerID of ["openai", "commandcode"]) {
  it.live(`Core SDK enforces ${providerID} privacy after request overrides`, () =>
    Effect.gen(function* () {
      const requests: { body: unknown; headers: Headers }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
          requests.push({ body: await request.json(), headers: request.headers })
          return Response.json({ error: { message: "captured" } }, { status: 400 })
        } })),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const { OpenAICompatiblePlugin } = yield* Effect.promise(() => import("@opencode-ai/core/plugin/provider/openai-compatible"))
      yield* OpenAICompatiblePlugin.effect(host)
      const aisdk = yield* AISDK.Service
      const language = yield* aisdk.language(ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make(providerID), ModelV2.ID.make("test-model")),
        api: { id: ModelV2.ID.make("test-model"), type: "aisdk", package: "@ai-sdk/openai-compatible", url: `http://127.0.0.1:${server.port}/v1` },
        request: { headers: {}, body: { apiKey: "test-key" } },
      }))
      yield* Effect.promise(() => Promise.resolve(language.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "privacy test" }] }],
        headers: { "x-cmd-zdr": "0" },
        providerOptions: { openai: { store: true } },
      })).then(() => undefined, () => undefined))
      expect(requests).toHaveLength(1)
      if (providerID === "openai") expect(requests[0].body).toMatchObject({ store: false })
      if (providerID === "commandcode") expect(requests[0].headers.get("x-cmd-zdr")).toBe("1")
      expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
    }),
  )
}
