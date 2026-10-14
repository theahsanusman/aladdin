import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { LLM } from "../src"
import { OpenAI } from "../src/providers"
import { LLMClient, ProviderPrivacy, RequestExecutor } from "../src/route"
import { it, testEffect } from "./lib/effect"

const live = testEffect(LLMClient.privacyLayer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))))

for (const protocol of ["chat", "responses"] as const) {
  live.live(`native OpenAI ${protocol} cannot reenable response storage through options or raw body overlays`, () =>
    Effect.gen(function* () {
      const requests: { headers: Headers; body: unknown }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
          requests.push({ headers: request.headers, body: await request.json() })
          return Response.json({ error: { message: "captured" } }, { status: 400 })
        } })),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const provider = OpenAI.configure({ apiKey: "test-key", baseURL: `http://127.0.0.1:${server.port}/v1` })
      const model = protocol === "chat" ? provider.chat("test-model") : provider.responses("test-model")
      yield* LLMClient.generate(LLM.request({
        model,
        prompt: "privacy test",
        providerOptions: { openai: { store: true } },
        http: { body: { store: true, metadata: { preserved: true } } },
      })).pipe(Effect.exit)
      expect(requests).toHaveLength(1)
      expect(requests[0].body).toMatchObject({ model: "test-model", store: false, metadata: { preserved: true } })
      expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
      if (protocol === "responses") expect(requests[0].body).toMatchObject({ include: ["reasoning.encrypted_content"] })
    }),
  )
}

it.effect("OpenAI WebSocket messages also force stateless encrypted-reasoning responses", () =>
  Effect.gen(function* () {
    const model = OpenAI.configure({ apiKey: "test-key" }).responsesWebSocket("test-model")
    const request = ProviderPrivacy.request(LLM.request({ model, prompt: "privacy test", providerOptions: { openai: { store: true } }, http: { body: { store: true } } }))
    const prepared = yield* model.route.prepareTransport(yield* model.route.body.from(request), request)
    expect(JSON.parse(prepared.message)).toMatchObject({ store: false, include: ["reasoning.encrypted_content"] })
  }),
)
