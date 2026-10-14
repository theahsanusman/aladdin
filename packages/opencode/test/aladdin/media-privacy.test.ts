import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../src/auth"
import { ServerAuth } from "../../src/server/auth"
import { AladdinApi } from "../../src/server/routes/instance/httpapi/groups/aladdin"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const audio = { audio: Buffer.from("synthetic audio").toString("base64"), mime: "audio/webm", model: "qwen3-asr-1.7b" }
const speech = { text: "synthetic speech", voice: "test-voice", model: "qwen3-tts-1.7b" }
const image = { provider: "draw-things", model: "synthetic.ckpt", prompt: "synthetic image" }

function media(input: { endpoint?: string; response?: (request: Request) => Response | Promise<Response> } = {}) {
  return Effect.gen(function* () {
    const requests: { path: string; body: unknown }[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const path = new URL(request.url).pathname
            const body = request.headers.get("content-type")?.startsWith("multipart/form-data")
              ? await request.formData().then(async (form) => ({
                  file: form.get("file") instanceof File ? await (form.get("file") as File).text() : undefined,
                  model: form.get("model"),
                  language: form.get("language"),
                }))
              : request.method === "POST"
                ? await request.json()
                : undefined
            requests.push({ path, body })
            if (input.response) return input.response(request)
            if (path === "/v1/audio/transcriptions") return Response.json({ text: "synthetic transcription" })
            if (path === "/v1/audio/speech")
              return new Response("synthetic audio", { headers: { "content-type": "audio/wav" } })
            if (path === "/v1/voices") return Response.json({ voices: ["test-voice"], english: ["test-voice"] })
            if (path === "/sdapi/v1/sd-models") return Response.json([{ title: "synthetic.ckpt" }])
            if (path === "/sdapi/v1/txt2img") return Response.json({ images: ["QUJD"] })
            return Response.json({})
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const endpoint = `http://127.0.0.1:${server.port}`
    const configured = input.endpoint?.replace("{port}", String(server.port)) ?? endpoint
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = [
          "ALADDIN_SPEECH_INPUT_URL",
          "ALADDIN_SPEECH_OUTPUT_URL",
          "ALADDIN_DRAW_THINGS_URL",
          "ALADDIN_ASR_MODEL",
        ].map((key) => ({ key, value: process.env[key] }))
        previous.forEach(({ key }) => {
          if (key === "ALADDIN_ASR_MODEL") delete process.env[key]
          if (key !== "ALADDIN_ASR_MODEL") process.env[key] = configured
        })
        return previous
      }),
      (previous) =>
        Effect.sync(() =>
          previous.forEach(({ key, value }) => {
            if (value === undefined) delete process.env[key]
            if (value !== undefined) process.env[key] = value
          }),
        ),
    )
    // Import after setting safe synthetic endpoints. The first status assertion prevents accidental use of live services.
    const { aladdinHandlers } = yield* Effect.promise(
      () => import("../../src/server/routes/instance/httpapi/handlers/aladdin"),
    )
    const context = yield* Layer.build(
      HttpRouter.serve(
        HttpApiBuilder.layer(HttpApi.make("opencode-root").add(AladdinApi.groups.aladdin)).pipe(
          Layer.provide(aladdinHandlers),
          Layer.provide([authorizationLayer, schemaErrorLayer]),
          HttpRouter.provideRequest(Layer.empty),
        ),
        { disableListenLog: true, disableLogger: true },
      ).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
        Layer.provide(Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })),
        Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode", desktopToken: Option.none() })),
      ),
    )
    return {
      endpoint,
      requests,
      request: (path: string, payload?: unknown) =>
        HttpClientRequest.fromWeb(
          new Request(
            `http://localhost${path}`,
            payload === undefined
              ? undefined
              : {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(payload),
                },
          ),
        ).pipe(HttpClientRequest.setUrl(path), HttpClient.execute, Effect.provide(context)),
    }
  })
}

describe("Aladdin local media privacy", () => {
  it.live("preserves local status, voice payloads, voices, and Draw Things discovery", () =>
    Effect.gen(function* () {
      const fixture = yield* media()
      const status = yield* fixture.request("/aladdin/status")
      expect(status.status).toBe(200)
      expect(yield* status.json).toEqual({
        speechInput: { available: true, endpoint: fixture.endpoint },
        speechOutput: { available: true, endpoint: fixture.endpoint },
        drawThingsModels: ["synthetic.ckpt"],
      })
      const transcription = yield* fixture.request("/aladdin/voice/transcribe", audio)
      expect(transcription.status).toBe(200)
      expect(yield* transcription.json).toEqual({ text: "synthetic transcription" })
      const spoken = yield* fixture.request("/aladdin/voice/speak", speech)
      expect(spoken.status).toBe(200)
      expect(yield* spoken.json).toEqual({ audio: audio.audio, mime: "audio/wav" })
      const voices = yield* fixture.request("/aladdin/voice/voices")
      expect(yield* voices.json).toEqual({ voices: ["test-voice"], english: ["test-voice"] })
      expect(fixture.requests.find((request) => request.path === "/v1/audio/transcriptions")?.body).toEqual({
        file: "synthetic audio",
        model: "mlx-community/Qwen3-ASR-1.7B-8bit",
        language: "en",
      })
      expect(fixture.requests.find((request) => request.path === "/v1/audio/speech")?.body).toEqual({
        input: "synthetic speech",
        model: "qwen3-tts-1.7b",
        voice: "test-voice",
        language: "english",
      })
    }),
  )

  it.live("marks non-loopback overrides unavailable and rejects voice without contacting them", () =>
    Effect.gen(function* () {
      const fixture = yield* media({ endpoint: "http://0.0.0.0:{port}" })
      const status = yield* fixture.request("/aladdin/status")
      expect(status.status).toBe(200)
      expect(yield* status.json).toEqual({
        speechInput: { available: false, endpoint: "" },
        speechOutput: { available: false, endpoint: "" },
        drawThingsModels: [],
      })
      for (const call of [
        fixture.request("/aladdin/voice/transcribe", audio),
        fixture.request("/aladdin/voice/speak", speech),
        fixture.request("/aladdin/voice/voices"),
      ]) {
        const response = yield* call
        expect(response.status).toBe(400)
      }
      expect(fixture.requests).toEqual([])
    }),
  )

  it.live("rejects redirects for probes, voice, discovery, and image generation", () =>
    Effect.gen(function* () {
      const redirected: string[] = []
      const target = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              redirected.push(await request.text())
              return Response.json({ text: "leaked", images: ["QUJD"], voices: ["leaked"] })
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const fixture = yield* media({
        response: () =>
          new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${target.port}/capture` } }),
      })
      const status = yield* fixture.request("/aladdin/status")
      expect(yield* status.json).toEqual({
        speechInput: { available: false, endpoint: fixture.endpoint },
        speechOutput: { available: false, endpoint: fixture.endpoint },
        drawThingsModels: [],
      })
      expect((yield* fixture.request("/aladdin/voice/transcribe", audio)).status).toBe(400)
      expect((yield* fixture.request("/aladdin/voice/speak", speech)).status).toBe(400)
      expect((yield* fixture.request("/aladdin/voice/voices")).status).toBe(400)
      const generated = yield* fixture.request("/aladdin/image/generate", image)
      expect(generated.status).toBe(502)
      expect(yield* generated.json).toEqual({
        _tag: "AladdinProviderError",
        message: "Draw Things image request failed",
      })
      expect(redirected).toEqual([])
    }),
  )

  it.live("returns safe media errors for null transcription and voice lists", () =>
    Effect.gen(function* () {
      const fixture = yield* media({ response: () => Response.json(null) })
      const status = yield* fixture.request("/aladdin/status")
      expect(yield* status.json).toMatchObject({
        speechInput: { endpoint: fixture.endpoint },
        speechOutput: { endpoint: fixture.endpoint },
      })
      expect((yield* fixture.request("/aladdin/voice/transcribe", audio)).status).toBe(400)
      expect((yield* fixture.request("/aladdin/voice/voices")).status).toBe(400)
    }),
  )

  it.live("does not return a JSON failure body as successful speech audio", () =>
    Effect.gen(function* () {
      const fixture = yield* media({
        response: () => Response.json({ error: "synthetic private prompt and credential" }),
      })
      const status = yield* fixture.request("/aladdin/status")
      expect(yield* status.json).toMatchObject({ speechOutput: { endpoint: fixture.endpoint } })
      const response = yield* fixture.request("/aladdin/voice/speak", speech)
      expect(response.status).toBe(400)
      expect(yield* response.text).not.toContain("synthetic private")
    }),
  )

  it.live("reports upstream status failures without returning private failure bodies", () =>
    Effect.gen(function* () {
      const fixture = yield* media({
        response: () => new Response("synthetic private prompt and credential", { status: 500 }),
      })
      const status = yield* fixture.request("/aladdin/status")
      expect(yield* status.json).toEqual({
        speechInput: { available: false, endpoint: fixture.endpoint },
        speechOutput: { available: false, endpoint: fixture.endpoint },
        drawThingsModels: [],
      })
      for (const call of [
        fixture.request("/aladdin/voice/transcribe", audio),
        fixture.request("/aladdin/voice/speak", speech),
        fixture.request("/aladdin/voice/voices"),
      ]) {
        const response = yield* call
        expect(response.status).toBe(400)
        expect(yield* response.text).not.toContain("synthetic private")
      }
      const generated = yield* fixture.request("/aladdin/image/generate", image)
      expect(generated.status).toBe(502)
      expect(yield* generated.json).toEqual({ _tag: "AladdinProviderError", message: "Draw Things returned 500" })
    }),
  )
})
