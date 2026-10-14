import { fetchLocalMedia, LocalMediaError } from "./local-media"

export type Provider = "openai" | "gemini" | "openrouter" | "draw-things"

export class ImageGenerationError extends Error {}

export type Request = {
  provider: Provider
  model: string
  prompt: string
  size?: string
}

export type Result = {
  image: string
  mime: string
}

function dataUrl(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value)
  if (!match) return
  return { mime: match[1]!, image: match[2]! }
}

export function parseCloudImage(provider: Exclude<Provider, "draw-things">, value: unknown): Result | undefined {
  if (!value || typeof value !== "object") return
  if (provider === "openrouter" && "choices" in value) {
    if (!Array.isArray(value.choices)) return
    const choice: unknown = value.choices[0]
    if (!choice || typeof choice !== "object" || !("message" in choice)) return
    const message = choice.message
    if (!message || typeof message !== "object" || !("images" in message) || !Array.isArray(message.images)) return
    const image: unknown = message.images[0]
    if (!image || typeof image !== "object" || !("image_url" in image)) return
    const url = image.image_url
    if (!url || typeof url !== "object" || !("url" in url) || typeof url.url !== "string") return
    return dataUrl(url.url)
  }
  if (provider === "openai" || provider === "openrouter") {
    if (!("data" in value) || !Array.isArray(value.data)) return
    const item: unknown = value.data[0]
    if (!item || typeof item !== "object") return
    const image = "b64_json" in item ? item.b64_json : undefined
    const mime = "media_type" in item ? item.media_type : undefined
    if (typeof image !== "string") return
    return { image, mime: typeof mime === "string" ? mime : "image/png" }
  }

  const candidates = (value as { candidates?: unknown[] }).candidates
  const candidate = candidates?.[0]
  if (!candidate || typeof candidate !== "object") return
  const parts = (candidate as { content?: { parts?: unknown[] } }).content?.parts
  const part = parts?.find((item) => {
    if (!item || typeof item !== "object") return false
    return "inlineData" in item || "inline_data" in item
  }) as
    | { inlineData?: { data?: unknown; mimeType?: unknown }; inline_data?: { data?: unknown; mime_type?: unknown } }
    | undefined
  const inline = part?.inlineData ?? part?.inline_data
  if (typeof inline?.data !== "string") return
  return {
    image: inline.data,
    mime:
      ("mimeType" in inline && typeof inline.mimeType === "string" ? inline.mimeType : undefined) ??
      ("mime_type" in inline && typeof inline.mime_type === "string" ? inline.mime_type : undefined) ??
      "image/png",
  }
}

export function parseDrawThingsImage(value: unknown): Result | undefined {
  if (!value || typeof value !== "object") return
  if (!("images" in value) || !Array.isArray(value.images)) return
  const image: unknown = value.images[0]
  if (typeof image !== "string") return
  const parsed = dataUrl(image)
  return parsed ?? { image, mime: "image/png" }
}

export async function generate(input: Request & { apiKey?: string; signal?: AbortSignal }): Promise<Result> {
  if (input.provider === "draw-things") {
    const response = await fetchLocalMedia(
      process.env.ALADDIN_DRAW_THINGS_URL ?? "http://127.0.0.1:7860",
      "/sdapi/v1/txt2img",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          model: input.model,
          ...(input.size ? size(input.size) : {}),
        }),
        signal: input.signal,
      },
    ).catch((error: unknown) => {
      throw new ImageGenerationError(
        error instanceof LocalMediaError ? error.message : "Draw Things image request failed",
      )
    })
    if (!response.ok) throw new ImageGenerationError(`Draw Things returned ${response.status}`)
    const result = parseDrawThingsImage(
      await response.json().catch(() => {
        throw new ImageGenerationError("Draw Things returned invalid JSON")
      }),
    )
    if (!result) throw new ImageGenerationError("Draw Things returned no image")
    return result
  }

  if (!input.apiKey) throw new ImageGenerationError(`No ${input.provider} API key is configured`)
  const endpoint =
    input.provider === "openai"
      ? "https://api.openai.com/v1/images/generations"
      : input.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.provider === "gemini"
        ? { "x-goog-api-key": input.apiKey }
        : { authorization: `Bearer ${input.apiKey}` }),
    },
    body: JSON.stringify(
      input.provider === "gemini"
        ? {
            contents: [{ parts: [{ text: input.prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }
        : input.provider === "openrouter"
          ? {
              model: input.model,
              messages: [{ role: "user", content: input.prompt }],
              modalities: ["image", "text"],
              ...(input.size ? { image_config: { size: input.size } } : {}),
              // The dedicated Image API's provider schema omits these privacy controls.
              // Chat image output uses the documented shared privacy-routing preferences instead.
              provider: { zdr: true, data_collection: "deny" },
            }
          : {
              model: input.model,
              prompt: input.prompt,
              ...(input.size ? { size: input.size } : {}),
              // Images has no store parameter. ZDR requires an approved organization/project and supported GPT image model.
              output_format: "png",
            },
    ),
    signal: input.signal,
    redirect: "error",
  }).catch(() => {
    throw new ImageGenerationError(`${input.provider} image request failed`)
  })
  if (!response.ok) throw new ImageGenerationError(`${input.provider} returned ${response.status}`)
  const result = parseCloudImage(
    input.provider,
    await response.json().catch(() => {
      throw new ImageGenerationError(`${input.provider} returned invalid JSON`)
    }),
  )
  if (!result) throw new ImageGenerationError(`${input.provider} returned no image`)
  return result
}

function size(value: string) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) return {}
  return { width: Number(match[1]), height: Number(match[2]) }
}
