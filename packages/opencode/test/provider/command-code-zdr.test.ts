import { afterEach, expect } from "bun:test"
import { APICallError, streamText } from "ai"
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

for (const npm of ["@ai-sdk/openai-compatible", "@ai-sdk/openai"]) {
  it.live(`Command Code ${npm} requests enforce ZDR after provider, model, and per-call header overrides`, () =>
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
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const model = yield* provider.getModel(ProviderV2.ID.make("commandcode"), ModelV2.ID.make("test-model"))
            const result = streamText({
              model: yield* provider.getLanguage(model),
              prompt: "privacy test",
              headers: { "X-CMD-ZDR": "0", "x-request-test": "preserved" },
              maxRetries: 2,
              onError() {},
            })
            const errors = yield* Effect.promise(async () => {
              const errors: unknown[] = []
              for await (const event of result.fullStream) if (event.type === "error") errors.push(event.error)
              return errors
            })
            expect(errors).toHaveLength(1)
            expect(APICallError.isInstance(errors[0])).toBe(true)
            expect(APICallError.isInstance(errors[0]) && errors[0].statusCode).toBe(422)
            expect(requests).toHaveLength(1)
            expect(requests[0].headers.get("x-cmd-zdr")).toBe("1")
            expect(requests[0].headers.get("x-request-test")).toBe("preserved")
            expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
            expect(requests[0].path).toBe(npm === "@ai-sdk/openai" ? "/v1/responses" : "/v1/chat/completions")
            expect(requests[0].body).toMatchObject({ model: "test-model" })
          }),
        { config: config(`http://127.0.0.1:${server.port}/v1`, "commandcode", npm) },
      )
    }),
  )
}

it.live("a Command Code endpoint under another provider name still sends ZDR", () =>
  Effect.gen(function* () {
    const requests: Headers[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            requests.push(request.headers)
            return Response.json({ error: { message: "captured" } }, { status: 422 })
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const configured = yield* provider.getProvider(ProviderV2.ID.make("alias"))
          configured.options.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
            return fetch(`http://127.0.0.1:${server.port}${url.pathname}`, init)
          }
          const model = yield* provider.getModel(ProviderV2.ID.make("alias"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            prompt: "privacy test",
            maxRetries: 0,
            onError() {},
          })
          yield* Effect.promise(() => result.consumeStream())
          expect(requests).toHaveLength(1)
          expect(requests[0].get("x-cmd-zdr")).toBe("1")
        }),
      { config: config("https://api.commandcode.ai/provider/v1", "alias") },
    )
  }),
)

it.live("unrelated provider requests retain their existing headers", () =>
  Effect.gen(function* () {
    const requests: Headers[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            requests.push(request.headers)
            return Response.json({ error: { message: "captured" } }, { status: 422 })
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const model = yield* provider.getModel(ProviderV2.ID.make("unrelated"), ModelV2.ID.make("test-model"))
          const result = streamText({
            model: yield* provider.getLanguage(model),
            prompt: "privacy test",
            maxRetries: 0,
            onError() {},
          })
          yield* Effect.promise(() => result.consumeStream())
          expect(requests).toHaveLength(1)
          expect(requests[0].get("x-cmd-zdr")).toBe("0")
        }),
      { config: config(`http://127.0.0.1:${server.port}/v1`, "unrelated") },
    )
  }),
)

function config(url: string, providerID: string, npm = "@ai-sdk/openai-compatible") {
  const base = testProviderConfig(url)
  return {
    formatter: false,
    lsp: false,
    enabled_providers: [providerID],
    provider: {
      [providerID]: {
        ...base.provider.test,
        id: providerID,
        npm,
        options: { ...base.provider.test.options, headers: { "x-cmd-zdr": "0" } },
        models: { "test-model": { ...base.provider.test.models["test-model"], headers: { "X-CMD-ZDR": "0" } } },
      },
    },
  }
}
