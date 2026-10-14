import { Option, Schema } from "effect"
import { isRecord } from "../utils/record"
import { LLMRequest } from "../schema/messages"
import { HttpOptions } from "../schema/options"

const hosts = new Set(["openrouter.ai", "eu.openrouter.ai", "us.openrouter.ai"])
const decode = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

export function isOpenRouter(url: URL, providerID?: string) {
  // The legacy catalog includes a Command Code endpoint under the OpenRouter provider name.
  if (url.hostname === "api.commandcode.ai") return false
  return providerID === "openrouter" || (hosts.has(url.hostname) && url.pathname.startsWith("/api/v1/"))
}

export function isOpenAI(url: URL, providerID?: string) {
  if (url.hostname === "api.commandcode.ai") return false
  return (
    providerID === "openai" ||
    ["api.openai.com", "eu.api.openai.com", "us.api.openai.com"].includes(url.hostname) ||
    (url.hostname === "chatgpt.com" && url.pathname.startsWith("/backend-api/codex/"))
  )
}

export function isCommandCode(url: URL, providerID?: string) {
  return (
    providerID === "commandcode" || (url.hostname === "api.commandcode.ai" && url.pathname.startsWith("/provider/"))
  )
}

export function hasBodyControls(url: URL, providerID?: string) {
  return (
    isOpenRouter(url, providerID) ||
    (isOpenAI(url, providerID) && /\/(responses|chat\/completions)\/?$/.test(url.pathname))
  )
}

export function request(input: LLMRequest) {
  const baseURL = input.model.route.endpoint.baseURL
  if (typeof baseURL !== "string" || !isOpenAI(new URL(baseURL), input.model.provider)) return input
  const responses = input.model.route.protocol === "openai-responses"
  return LLMRequest.update(input, {
    providerOptions: { ...input.providerOptions, openai: { ...input.providerOptions?.openai, store: false } },
    http: HttpOptions.make({
      ...input.http,
      body: body(
        input.http?.body ?? {},
        new URL(`${baseURL.replace(/\/$/, "")}/${responses ? "responses" : "chat/completions"}`),
        input.model.provider,
      ),
    }),
  })
}

export function body(value: unknown, url: URL, providerID?: string) {
  if (!isRecord(value)) throw new Error("Provider privacy enforcement requires a JSON object request body")
  const routed = isOpenRouter(url, providerID)
    ? {
        ...value,
        provider: { ...(isRecord(value.provider) ? value.provider : {}), zdr: true, data_collection: "deny" },
      }
    : value
  if (!isOpenAI(url, providerID) || !/\/(responses|chat\/completions)\/?$/.test(url.pathname)) return routed
  if (!url.pathname.endsWith("/responses")) return { ...routed, store: false }
  return {
    ...routed,
    store: false,
    // Stateless reasoning must stay replayable from local history rather than provider-side response storage.
    include: Array.from(
      new Set([
        ...(Array.isArray(value.include)
          ? value.include.filter((item): item is string => typeof item === "string")
          : []),
        "reasoning.encrypted_content",
      ]),
    ),
  }
}

type Fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit & { timeout?: false }) => Promise<Response>

export const wrapFetch =
  (fetcher: Fetch, providerID?: string): Fetch =>
  async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const commandCode = isCommandCode(url, providerID)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (commandCode) headers.set("x-cmd-zdr", "1")
    if (
      !hasBodyControls(url, providerID) ||
      (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "POST"
    )
      return fetcher(input, commandCode ? { ...init, headers } : init)

    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
    if (typeof raw !== "string") throw new Error("Provider privacy enforcement requires a JSON object request body")
    headers.delete("content-length")
    // Enforce after all SDK, model, agent, variant, and per-call body merges. Never retry without these controls.
    return fetcher(input, { ...init, headers, body: encode(body(Option.getOrUndefined(decode(raw)), url, providerID)) })
  }

export * as ProviderPrivacy from "./provider-privacy"
