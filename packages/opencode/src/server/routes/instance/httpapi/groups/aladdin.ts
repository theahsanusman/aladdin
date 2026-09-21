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

const Voices = Schema.Struct({
  voices: Schema.Array(Schema.String),
  english: Schema.Array(Schema.String),
})

export const OpenAIProfileInput = Schema.Struct({
  profile: Schema.Union([Schema.Literal("personal"), Schema.Literal("company")]),
})

const OpenAIProfiles = Schema.Struct({
  personal: Schema.Boolean,
  company: Schema.Boolean,
  personalIdentity: Schema.optional(Schema.String),
  companyIdentity: Schema.optional(Schema.String),
  active: Schema.optional(Schema.Union([Schema.Literal("personal"), Schema.Literal("company")])),
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

const MobileStatus = Schema.Struct({
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  reason: Schema.optional(Schema.Literal("password-required")),
  url: Schema.optional(Schema.String),
  connectUrl: Schema.optional(Schema.String),
  host: Schema.String,
  port: Schema.optional(Schema.Number),
  addresses: Schema.Array(Schema.String),
  certificateAuthority: Schema.optional(Schema.String),
  certificate: Schema.optional(
    Schema.Struct({
      names: Schema.String,
      dates: Schema.String,
    }),
  ),
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
      HttpApiEndpoint.get("voices", "/aladdin/voice/voices", {
        success: described(Voices, "Voices supported by the local speech service"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.get("openAIProfiles", "/aladdin/auth/openai/profiles", {
        success: described(OpenAIProfiles, "Saved OpenAI account profiles"),
      }),
      HttpApiEndpoint.post("saveOpenAIProfile", "/aladdin/auth/openai/profiles/save", {
        payload: OpenAIProfileInput,
        success: described(OpenAIProfiles, "Saved OpenAI account profile"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("activateOpenAIProfile", "/aladdin/auth/openai/profiles/activate", {
        payload: OpenAIProfileInput,
        success: described(OpenAIProfiles, "Activated OpenAI account profile"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("image", "/aladdin/image/generate", {
        payload: ImageInput,
        success: described(Image, "Generated image"),
        error: [HttpApiError.BadRequest, AladdinProviderError],
      }),
      HttpApiEndpoint.get("mobileStatus", "/aladdin/mobile/status", {
        success: described(MobileStatus, "Same-network mobile access status"),
      }),
      HttpApiEndpoint.post("mobileEnable", "/aladdin/mobile/enable", {
        success: described(MobileStatus, "Same-network mobile access status"),
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("mobileDisable", "/aladdin/mobile/disable", {
        success: described(MobileStatus, "Same-network mobile access status"),
      }),
    )
    .annotateMerge(OpenApi.annotations({ title: "Aladdin", description: "Local Aladdin media services." })),
)
