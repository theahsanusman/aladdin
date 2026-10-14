import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { LLM } from "../src"
import { OpenAI, OpenAICompatible } from "../src/providers"
import { Auth, LLMClient, RequestExecutor } from "../src/route"
import { testEffect, it } from "./lib/effect"
import { dynamicResponse } from "./lib/http"

const live = testEffect(
  LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(FetchHttpClient.layer)))),
)

for (const protocol of ["chat", "responses"] as const) {
  live.live(`native Command Code ${protocol} sends ZDR after all default, per-request, and auth overrides`, () =>
    Effect.gen(function* () {
      const requests: { path: string; headers: Headers; body: unknown }[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              requests.push({
                path: new URL(request.url).pathname,
                headers: request.headers,
                body: await request.json(),
              })
              return Response.json(
                { error: { code: "cmd_zdr_no_providers", message: "ZDR capacity unavailable" } },
                { status: 422 },
              )
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const options = {
        baseURL: `http://127.0.0.1:${server.port}/provider/v1`,
        apiKey: "test-key",
        headers: { "X-CMD-ZDR": "0" },
      }
      const model =
        protocol === "chat"
          ? OpenAICompatible.configure({ ...options, provider: "commandcode" }).model("test-model")
          : OpenAI.configure(options).responses("test-model")
      const route = model.route.with({
        provider: "commandcode",
        auth: Auth.bearer("test-key").andThen(Auth.headers({ "x-cmd-zdr": "0" })),
      })
      const result = yield* LLMClient.generate(
        LLM.request({
          model: route.model({ id: "test-model" }),
          prompt: "privacy test",
          http: { headers: { "X-CMD-ZDR": "0", "x-request-test": "preserved" } },
        }),
      ).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
      expect(requests).toHaveLength(1)
      expect(requests[0].headers.get("x-cmd-zdr")).toBe("1")
      expect(requests[0].headers.get("x-request-test")).toBe("preserved")
      expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
      expect(requests[0].path).toBe(protocol === "chat" ? "/provider/v1/chat/completions" : "/provider/v1/responses")
      expect(requests[0].body).toMatchObject({ model: "test-model" })
    }),
  )
}

for (const endpoint of [
  { url: "https://api.commandcode.ai/provider/v1", zdr: "1" },
  { url: "https://api.commandcode.ai.evil.example/provider/v1", zdr: "0" },
  { url: "https://unrelated.example/provider/v1", zdr: "0" },
] as const) {
  it.effect(`native endpoint detection preserves the correct header for ${endpoint.url}`, () =>
    Effect.gen(function* () {
      const model = OpenAICompatible.configure({ provider: "alias", baseURL: endpoint.url, apiKey: "test-key" }).model(
        "test-model",
      )
      yield* LLMClient.generate(
        LLM.request({ model, prompt: "privacy test", http: { headers: { "x-cmd-zdr": "0" } } }),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              expect(input.request.headers["x-cmd-zdr"]).toBe(endpoint.zdr)
              expect(JSON.parse(input.text)).toMatchObject({
                model: "test-model",
                messages: [{ role: "user", content: "privacy test" }],
              })
              return input.respond(
                'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
    }),
  )
}

it.effect("native WebSocket preparation also enforces the Command Code header", () =>
  Effect.gen(function* () {
    const model = OpenAI.configure({
      baseURL: "https://api.commandcode.ai/provider/v1",
      apiKey: "test-key",
    }).responsesWebSocket("test-model")
    const request = LLM.request({ model, prompt: "privacy test", http: { headers: { "X-CMD-ZDR": "0" } } })
    const prepared = yield* model.route.prepareTransport(yield* model.route.body.from(request), request)
    expect(prepared.headers["x-cmd-zdr"]).toBe("1")
  }),
)
