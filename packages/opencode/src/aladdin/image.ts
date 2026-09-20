export type Provider = "openai" | "gemini" | "openrouter" | "draw-things"

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
  if (provider === "openai" || provider === "openrouter") {
    const item = (value as { data?: unknown[] }).data?.[0]
    if (!item || typeof item !== "object") return
    const image = (item as { b64_json?: unknown }).b64_json
    const mime = (item as { media_type?: unknown }).media_type
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
  const image = (value as { images?: unknown[] }).images?.[0]
  if (typeof image !== "string") return
  const parsed = dataUrl(image)
  return parsed ?? { image, mime: "image/png" }
}

export async function generate(input: Request & { apiKey?: string; signal?: AbortSignal }): Promise<Result> {
  if (input.provider === "draw-things") {
    const response = await fetch(`${process.env.ALADDIN_DRAW_THINGS_URL ?? "http://127.0.0.1:7860"}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        model: input.model,
        ...(input.size ? size(input.size) : {}),
      }),
      signal: input.signal,
    })
    if (!response.ok) throw new Error(`Draw Things returned ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const result = parseDrawThingsImage(await response.json())
    if (!result) throw new Error("Draw Things returned no image")
    return result
  }

  if (!input.apiKey) throw new Error(`No ${input.provider} API key is configured`)
  const endpoint =
    input.provider === "openai"
      ? "https://api.openai.com/v1/images/generations"
      : input.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/images"
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
        : {
            model: input.model,
            prompt: input.prompt,
            ...(input.size ? { size: input.size } : {}),
            ...(input.provider === "openai" ? { output_format: "png" } : {}),
          },
    ),
    signal: input.signal,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined)
    const detail = body && typeof body === "object" && "error" in body
      ? (body.error as { message?: unknown })?.message
      : undefined
    throw new Error(`${input.provider} returned ${response.status}${typeof detail === "string" ? `: ${detail.slice(0, 300)}` : ""}`)
  }
  const result = parseCloudImage(input.provider, await response.json())
  if (!result) throw new Error(`${input.provider} returned no image`)
  return result
}

function size(value: string) {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) return {}
  return { width: Number(match[1]), height: Number(match[2]) }
}
