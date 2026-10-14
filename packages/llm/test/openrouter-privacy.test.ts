import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { LLM } from "../src"
import { OpenAI, OpenAICompatible, OpenRouter } from "../src/providers"
import { LLMClient, RequestExecutor } from "../src/route"
import { dynamicResponse } from "./lib/http"
import { it, testEffect } from "./lib/effect"

const live = testEffect(
  LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
)

for (const protocol of ["openrouter", "compatible", "responses"] as const) {
  live.live(`native OpenRouter ${protocol} enforces privacy after model defaults and per-request body overrides`, () =>
    Effect.gen(function* () {
      const requests: { path: string; headers: Headers; body: unknown }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              requests.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() })
              return Response.json({ error: { code: 404, message: "No endpoints match the data policy" } }, { status: 404 })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const options = {
        baseURL: `http://127.0.0.1:${server.port}/api/v1`,
        apiKey: "test-key",
        http: { body: { provider: { zdr: false, data_collection: "allow", order: ["preserved"], allow_fallbacks: true } } },
      }
      const model = protocol === "openrouter"
        ? OpenRouter.configure(options).model("test-model")
        : protocol === "compatible"
          ? OpenAICompatible.configure({ ...options, provider: "openrouter" }).model("test-model")
          : OpenAI.configure(options).responses("test-model")
      const route = model.route.with({ provider: "openrouter" })
      const result = yield* LLMClient.generate(LLM.request({
        model: route.model({ id: "test-model" }),
        prompt: "privacy test",
        providerOptions: { openrouter: { provider: { zdr: false, data_collection: "allow" } } },
        http: {
          headers: { "x-preserved": "yes" },
          body: { provider: { zdr: false, data_collection: "allow" }, metadata: { preserved: true } },
        },
      })).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
      expect(requests).toHaveLength(1)
      expect(requests[0].body).toMatchObject({
        model: "test-model",
        provider: { zdr: true, data_collection: "deny", order: ["preserved"], allow_fallbacks: true },
        metadata: { preserved: true },
      })
      expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
      expect(requests[0].headers.get("x-preserved")).toBe("yes")
      expect(requests[0].path).toBe(protocol === "responses" ? "/api/v1/responses" : "/api/v1/chat/completions")
    }),
  )
}

for (const endpoint of [
  { url: "https://openrouter.ai/api/v1", provider: "alias", protected: true },
  { url: "https://eu.openrouter.ai/api/v1", provider: "alias", protected: true },
  { url: "https://us.openrouter.ai/api/v1", provider: "alias", protected: true },
  { url: "https://openrouter.ai.evil.example/api/v1", provider: "alias", protected: false },
  { url: "https://unrelated.example/v1", provider: "unrelated", protected: false },
  { url: "https://api.commandcode.ai/provider/v1", provider: "openrouter", protected: false },
] as const) {
  it.effect(`native privacy detection honors the actual endpoint ${endpoint.url}`, () =>
    Effect.gen(function* () {
      const model = OpenAICompatible.configure({ provider: endpoint.provider, baseURL: endpoint.url, apiKey: "test-key" }).model("test-model")
      const seen: unknown[] = []
      yield* LLMClient.generate(LLM.request({
        model,
        prompt: "privacy test",
        http: { body: { provider: { zdr: false, data_collection: "allow" } } },
      })).pipe(Effect.provide(dynamicResponse((input) => Effect.sync(() => {
        seen.push(JSON.parse(input.text))
        return input.respond('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
      }))))
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ provider: endpoint.protected
        ? { zdr: true, data_collection: "deny" }
        : { zdr: false, data_collection: "allow" } })
    }),
  )
}

it.effect("WebSocket preparation carries enforced OpenRouter privacy in the wire message", () =>
  Effect.gen(function* () {
    const model = OpenAI.configure({ baseURL: "https://openrouter.ai/api/v1", apiKey: "test-key" }).responsesWebSocket("test-model")
    const request = LLM.request({ model, prompt: "privacy test", http: { body: { provider: { zdr: false, data_collection: "allow" } } } })
    const prepared = yield* model.route.prepareTransport(yield* model.route.body.from(request), request)
    expect(JSON.parse(prepared.message)).toMatchObject({ provider: { zdr: true, data_collection: "deny" } })
  }),
)
