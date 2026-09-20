import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { AladdinProviderError } from "../errors"

const LocalService = Schema.Struct({
  available: Schema.Boolean,
  endpoint: Schema.String,
})

const Status = Schema.Struct({
  speechInput: LocalService,
  speechOutput: LocalService,
  drawThingsModels: Schema.Array(Schema.String),
})

export const TranscriptionInput = Schema.Struct({
  audio: Schema.String,
  mime: Schema.String,
  model: Schema.Literal("qwen3-asr-1.7b"),
})

const Transcription = Schema.Struct({ text: Schema.String })

export const SpeechInput = Schema.Struct({
  text: Schema.String,
  model: Schema.Literal("qwen3-tts-1.7b"),
  voice: Schema.String,
})

const Speech = Schema.Struct({
  audio: Schema.String,
  mime: Schema.String,
})

export const ImageInput = Schema.Struct({
  provider: Schema.Union([
    Schema.Literal("openai"),
    Schema.Literal("gemini"),
    Schema.Literal("openrouter"),
    Schema.Literal("draw-things"),
  ]),
  model: Schema.String,
  prompt: Schema.String,
  size: Schema.optional(Schema.String),
})

const Image = Schema.Struct({
  image: Schema.String,
  mime: Schema.String,
})

export const AladdinApi = HttpApi.make("aladdin").add(
  HttpApiGroup.make("aladdin")
    .add(
      HttpApiEndpoint.get("status", "/aladdin/status", {
        success: described(Status, "Aladdin local media status"),
      }),
      HttpApiEndpoint.post("transcribe", "/aladdin/voice/transcribe", {
        payload: TranscriptionInput,
        success: described(Transcription, "Local transcription"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("speak", "/aladdin/voice/speak", {
        payload: SpeechInput,
        success: described(Speech, "Local speech audio"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("image", "/aladdin/image/generate", {
        payload: ImageInput,
        success: described(Image, "Generated image"),
        error: [HttpApiError.BadRequest, AladdinProviderError],
      }),
    )
    .annotateMerge(OpenApi.annotations({ title: "Aladdin", description: "Local Aladdin media services." })),
)
