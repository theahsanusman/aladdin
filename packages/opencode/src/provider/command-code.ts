import { Option, Schema } from "effect"
import { isRecord } from "@/util/record"
import { ProviderError } from "./error"

const decodeJSON = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const roles = new Set(["system", "developer", "user", "assistant"])

export function commandCodeResponsesRequest(input: RequestInfo | URL, init: RequestInit): RequestInit {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!url.endsWith("/responses") || typeof init.body !== "string") return init

  const parsed = decodeJSON(init.body)
  if (Option.isNone(parsed) || !isRecord(parsed.value) || !Array.isArray(parsed.value.input)) return init

  // Command Code requires type on replayed assistant messages, while the OpenAI SDK omits it.
  const messages = parsed.value.input.map((item: unknown) =>
    isRecord(item) && !Object.hasOwn(item, "type") && typeof item.role === "string" && roles.has(item.role)
      ? { type: "message", ...item }
      : item,
  )
  const reasoning = parsed.value.reasoning
  if (!isRecord(reasoning) || !Object.hasOwn(reasoning, "summary"))
    return { ...init, body: JSON.stringify({ ...parsed.value, input: messages }) }

  // Command Code accepts reasoning effort but rejects OpenAI's summary option.
  const { summary: _, ...supportedReasoning } = reasoning
  return { ...init, body: JSON.stringify({ ...parsed.value, input: messages, reasoning: supportedReasoning }) }
}

export function commandCodeResponsesResponse(input: RequestInfo | URL, response: Response): Response {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!url.endsWith("/responses") || !response.ok || !response.body) return response
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response

  const state = { pending: "", terminal: false }
  const decoder = new TextDecoder()
  // The SDK silently finishes an EOF without response.completed as an empty, unknown turn.
  // Command Code can end its stream while MiMo is still reasoning, so require a terminal event.
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        state.pending += decoder.decode(chunk, { stream: true })
        const frames = state.pending.split(/\r?\n\r?\n/)
        state.pending = frames.pop() ?? ""
        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          const parsed = decodeJSON(data)
          if (
            Option.isSome(parsed) &&
            isRecord(parsed.value) &&
            ["response.completed", "response.incomplete", "response.failed", "error"].includes(
              String(parsed.value.type),
            )
          )
            state.terminal = true
        }
        controller.enqueue(chunk)
      },
      flush() {
        if (!state.terminal)
          throw new ProviderError.ResponseStreamError(
            "CommandCode connection lost: response stream ended before a completion event. The provider did not finish this response.",
          )
      },
    }),
  )
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

export * as CommandCode from "./command-code"
