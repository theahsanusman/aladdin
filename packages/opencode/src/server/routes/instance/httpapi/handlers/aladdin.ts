import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ImageInput, SpeechInput, TranscriptionInput } from "../groups/aladdin"
import { Auth } from "@/auth"
import { generate } from "@/aladdin/image"
import { AladdinProviderError } from "../errors"

const qwenEndpoint = "http://127.0.0.1:43121"
const ttsEndpoint = "http://127.0.0.1:43122"
const inputEndpoint = process.env.ALADDIN_SPEECH_INPUT_URL ?? qwenEndpoint
const outputEndpoint = process.env.ALADDIN_SPEECH_OUTPUT_URL ?? ttsEndpoint

async function available(endpoint: string, probe = "/health") {
  return fetch(`${endpoint}${probe}`, { signal: AbortSignal.timeout(750) }).then(
    (response) => response.ok,
    () => false,
  )
}

async function drawThingsModels() {
  const response = await fetch(`${process.env.ALADDIN_DRAW_THINGS_URL ?? "http://127.0.0.1:7860"}/sdapi/v1/sd-models`, {
    signal: AbortSignal.timeout(750),
  }).catch(() => undefined)
  if (response?.ok) {
    const models = await response.json().catch(() => undefined)
    if (Array.isArray(models)) {
      return models.flatMap((model) =>
        model && typeof model === "object" && typeof model.title === "string" ? [model.title] : [],
      )
    }
  }
  const directory = path.join(os.homedir(), "Library/Containers/com.liuliu.draw-things/Data/Documents/Models")
  const glob = new Bun.Glob("**/*.{ckpt,safetensors,pth}")
  const models: string[] = []
  try {
    for await (const file of glob.scan({ cwd: directory, absolute: false, onlyFiles: true })) {
      models.push(file)
    }
  } catch {
    return []
  }
  return models.sort((a, b) => a.localeCompare(b))
}

function mediaError() {
  return new HttpApiError.BadRequest({})
}

export const aladdinHandlers = HttpApiBuilder.group(RootHttpApi, "aladdin", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const status = Effect.fn("AladdinHttpApi.status")(function* () {
      const [speechInput, speechOutput, models] = yield* Effect.promise(() =>
        Promise.all([
          available(inputEndpoint, "/v1/models"),
          available(outputEndpoint),
          drawThingsModels(),
        ]),
      )
      return {
        speechInput: { available: speechInput, endpoint: inputEndpoint },
        speechOutput: { available: speechOutput, endpoint: outputEndpoint },
        drawThingsModels: models,
      }
    })

    const transcribe = Effect.fn("AladdinHttpApi.transcribe")(function* (ctx: {
      payload: typeof TranscriptionInput.Type
    }) {
      if (ctx.payload.audio.length > 40_000_000) return yield* Effect.fail(mediaError())
      const audio = Buffer.from(ctx.payload.audio, "base64")
      const form = new FormData()
      form.set(
        "file",
        new File([audio], `recording.${ctx.payload.mime.includes("mp4") ? "m4a" : "webm"}`, { type: ctx.payload.mime }),
      )
      form.set("model", process.env.ALADDIN_ASR_MODEL ?? "mlx-community/Qwen3-ASR-1.7B-8bit")
      form.set("language", "en")
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${inputEndpoint}/v1/audio/transcriptions`, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(120_000),
          }),
        catch: mediaError,
      })
      if (!response.ok) return yield* Effect.fail(mediaError())
      const result = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ text?: unknown }>,
        catch: mediaError,
      })
      if (typeof result.text !== "string") return yield* Effect.fail(mediaError())
      return { text: result.text }
    })

    const speak = Effect.fn("AladdinHttpApi.speak")(function* (ctx: { payload: typeof SpeechInput.Type }) {
      if (!ctx.payload.text.trim() || ctx.payload.text.length > 20_000) return yield* Effect.fail(mediaError())
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${outputEndpoint}/v1/audio/speech`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: ctx.payload.text,
              model: ctx.payload.model,
              voice: ctx.payload.voice,
              language: "english",
            }),
            signal: AbortSignal.timeout(120_000),
          }),
        catch: mediaError,
      })
      if (!response.ok) return yield* Effect.fail(mediaError())
      const buffer = yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: mediaError,
      })
      return {
        audio: Buffer.from(buffer).toString("base64"),
        mime: response.headers.get("content-type") ?? "audio/wav",
      }
    })

    const image = Effect.fn("AladdinHttpApi.image")(function* (ctx: { payload: typeof ImageInput.Type }) {
      if (!ctx.payload.prompt.trim() || ctx.payload.prompt.length > 20_000 || !ctx.payload.model.trim()) {
        return yield* Effect.fail(mediaError())
      }
      const credentials = yield* auth.get(ctx.payload.provider === "gemini" ? "google" : ctx.payload.provider).pipe(Effect.orDie)
      const apiKey = credentials?.type === "api" ? credentials.key : undefined
      return yield* Effect.tryPromise({
        try: () => generate({ ...ctx.payload, apiKey, signal: AbortSignal.timeout(300_000) }),
        catch: (error) => new AladdinProviderError({ message: error instanceof Error ? error.message : "Image generation failed" }),
      })
    })

    return handlers
      .handle("status", status)
      .handle("transcribe", transcribe)
      .handle("speak", speak)
      .handle("image", image)
  }),
)
