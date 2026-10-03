import { expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"
import { commandCodeResponsesRequest, commandCodeResponsesResponse } from "@/provider/command-code"
import { ProviderError } from "@/provider/error"
import { streamText } from "ai"

test("reports the real SDK's reasoning-only truncated Responses stream as a retryable transport error", async () => {
  const sdk = createOpenAI({
    apiKey: "test",
    fetch: Object.assign(
      async (url: RequestInfo | URL) =>
        commandCodeResponsesResponse(
          url,
          new Response(
            'data: {"type":"response.created","response":{"id":"r","created_at":1,"model":"mimo","status":"in_progress"}}\n\n' +
              'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"thinking","summary":[]}}\n\n' +
              'data: {"type":"response.reasoning.delta","item_id":"thinking","delta":"thinking"}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
      { preconnect: fetch.preconnect },
    ),
  })
  const result = streamText({ model: sdk.responses("xiaomi/mimo-v2.6-flash"), prompt: "Hi", maxRetries: 0 })
  const errors: unknown[] = []
  for await (const event of result.fullStream) if (event.type === "error") errors.push(event.error)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(ProviderError.ResponseStreamError)
  expect(String(errors[0])).toContain("response stream ended before a completion event")
})

test.each(["response.completed", "response.incomplete", "response.failed", "error"])(
  "preserves %s, fragmented UTF-8 and CRLF byte for byte",
  async (type) => {
    const text =
      ': heartbeat\r\n\r\ndata: {"type":"response.reasoning.delta","delta":"確認"}\r\n\r\n' +
      `data: {"type":"${type}"}\r\n\r\n`
    const chunks = new TextEncoder().encode(text)
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of chunks) controller.enqueue(new Uint8Array([byte]))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
    expect(
      await commandCodeResponsesResponse("https://api.commandcode.ai/provider/v1/responses", response).text(),
    ).toBe(text)
  },
)

test("rejects a truncated stream after partial text instead of mistaking it for completion", async () => {
  const response = new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', {
    headers: { "content-type": "text/event-stream" },
  })
  await expect(
    commandCodeResponsesResponse("https://api.commandcode.ai/provider/v1/responses", response).text(),
  ).rejects.toThrow(ProviderError.ResponseStreamError)
})

test("passes unrelated endpoints and HTTP errors through untouched", () => {
  const stream = new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  expect(commandCodeResponsesResponse("https://api.commandcode.ai/provider/v1/chat/completions", stream)).toBe(stream)
  const error = Response.json({ error: { message: "Rejected" } }, { status: 400 })
  expect(commandCodeResponsesResponse("https://api.commandcode.ai/provider/v1/responses", error)).toBe(error)
  const json = Response.json({ id: "completed" })
  expect(commandCodeResponsesResponse("https://api.commandcode.ai/provider/v1/responses", json)).toBe(json)
})

test("cancels the underlying stream when its consumer stops", async () => {
  const cancelled = Promise.withResolvers<unknown>()
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"))
      },
      cancel(reason) {
        cancelled.resolve(reason)
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
  const reader = commandCodeResponsesResponse(
    "https://api.commandcode.ai/provider/v1/responses",
    response,
  ).body!.getReader()
  await reader.read()
  await reader.cancel("User stopped")
  expect(await cancelled.promise).toBe("User stopped")
})

test("normalizes the installed AI SDK's actual Responses payload", async () => {
  const requests: unknown[] = []
  const sdk = createOpenAI({
    apiKey: "test",
    baseURL: "https://api.commandcode.ai/provider/v1",
    fetch: Object.assign(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(commandCodeResponsesRequest(url, init ?? {}).body as string))
        return Response.json({ error: { message: "captured" } }, { status: 400 })
      },
      { preconnect: fetch.preconnect },
    ),
  })

  await Promise.resolve(
    sdk.responses("deepseek/deepseek-v4.1-flash").doGenerate({
      prompt: [
        { role: "system", content: "instructions" },
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
        { role: "user", content: [{ type: "text", text: "hi again" }] },
      ],
    }),
  ).catch(() => {})

  expect(requests).toHaveLength(1)
  expect((requests[0] as { input: unknown[] }).input).toEqual([
    { type: "message", role: "system", content: "instructions" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi again" }] },
  ])
})

test("adds the message type required by Command Code Responses", () => {
  const input = [
    { role: "system", content: "instructions" },
    { role: "user", content: [{ type: "input_text", text: "hi" }] },
    { role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    { type: "function_call", call_id: "call_1", name: "echo", arguments: "{}" },
    { type: "function_call_output", call_id: "call_1", output: "ok" },
  ]
  const request = commandCodeResponsesRequest("https://api.commandcode.ai/provider/v1/responses", {
    body: JSON.stringify({ model: "deepseek/deepseek-v4.1-flash", input }),
  })

  expect(JSON.parse(request.body as string).input).toEqual([
    { type: "message", ...input[0] },
    { type: "message", ...input[1] },
    { type: "message", ...input[2] },
    input[3],
    input[4],
  ])
  expect(input[0]).not.toHaveProperty("type")
})

test("leaves unrelated requests unchanged", () => {
  const request = { body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }
  expect(commandCodeResponsesRequest("https://api.commandcode.ai/provider/v1/chat/completions", request)).toBe(request)
})

test.each(["high", "max"])("omits unsupported reasoning summary for %s", (effort) => {
  const request = commandCodeResponsesRequest("https://api.commandcode.ai/provider/v1/responses", {
    body: JSON.stringify({
      model: "deepseek/deepseek-v4.1-flash",
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      reasoning: { effort, summary: "auto" },
    }),
  })

  expect(JSON.parse(request.body as string)).toEqual({
    model: "deepseek/deepseek-v4.1-flash",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    reasoning: { effort },
  })
})

test.each(["high", "max"])("normalizes the SDK reasoning payload for %s", async (effort) => {
  const requests: unknown[] = []
  const sdk = createOpenAI({
    apiKey: "test",
    baseURL: "https://api.commandcode.ai/provider/v1",
    fetch: Object.assign(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(commandCodeResponsesRequest(url, init ?? {}).body as string))
        return Response.json({ error: { message: "captured" } }, { status: 400 })
      },
      { preconnect: fetch.preconnect },
    ),
  })

  await Promise.resolve(
    sdk.responses("deepseek/deepseek-v4.1-flash").doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: effort, reasoningSummary: "auto" } },
    }),
  ).catch(() => {})

  expect(requests).toHaveLength(1)
  expect((requests[0] as { reasoning: unknown }).reasoning).toEqual({ effort })
})
