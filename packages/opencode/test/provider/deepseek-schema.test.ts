import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Task } from "@opencode-ai/schema/task"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ToolJsonSchema } from "@/tool/json-schema"

const model = {
  providerID: "opencode-go",
  api: { id: "deepseek-v4.1-flash", npm: "@ai-sdk/openai-compatible", url: "https://opencode.ai/inference/go/v1" },
} as Provider.Model

test("DeepSeek Go accepts the actual dispatch tool schema without regex annotations", () => {
  const input = ToolJsonSchema.fromSchema(Task.DispatchInput)
  const original = JSON.stringify(input)
  expect(original).toContain('"pattern":')
  const result = ProviderTransform.schema(model, input)
  expect(JSON.stringify(result)).not.toContain('"pattern":')
  expect(result).toMatchObject({ type: "object", required: ["dispatchKey", "brief"] })
  expect(JSON.stringify(input)).toBe(original)
})

test("other compatible models retain their schema constraints", () => {
  const input = ToolJsonSchema.fromSchema(Task.DispatchInput)
  expect(ProviderTransform.schema({ ...model, api: { ...model.api, id: "mimo-v2.6-flash" } }, input)).toEqual(input)
})

test("keeps tool properties named pattern and their length constraints", () => {
  expect(
    ProviderTransform.schema(model, {
      type: "object",
      properties: { pattern: { type: "string", pattern: "^ok$", minLength: 2 } },
      required: ["pattern"],
    }),
  ).toEqual({ type: "object", properties: { pattern: { type: "string", minLength: 2 } }, required: ["pattern"] })
})

test("dispatch decoding still refuses absolute paths", () => {
  const execution = {
    engine: "v1",
    agent: "michael",
    model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" },
    mode: "coding",
    maxCalls: 1,
    wallClockMs: 1000,
  }
  expect(() => Schema.decodeUnknownSync(Task.Execution)({ ...execution, paths: ["/etc/passwd"] })).toThrow()
  expect(Schema.decodeUnknownSync(Task.Execution)({ ...execution, paths: ["src"] }).paths).toEqual(["src"])
})

test("preserves literal pattern fields inside defaults and enums", () => {
  const input = {
    type: "object" as const,
    properties: {
      settings: { type: "object" as const, default: { pattern: "user value" }, enum: [{ pattern: "allowed value" }] },
    },
  }
  expect(ProviderTransform.schema(model, input)).toEqual(input)
})
