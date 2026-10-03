import { Option, Schema } from "effect"
import { isRecord } from "@/util/record"

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

export * as CommandCode from "./command-code"
