import { expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"
import { commandCodeResponsesRequest } from "@/provider/command-code"

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
