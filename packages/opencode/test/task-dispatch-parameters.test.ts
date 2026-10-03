import { expect, test } from "bun:test"
import { Schema } from "effect"
import { TaskDispatchV1 } from "../src/task/dispatch-v1"

const base = {
  title: "Weather",
  objective: "Fetch current weather",
  scope: ["Miami"],
  output: "Dated report",
  checks: ["output:nonempty"],
  constraints: ["No shell"],
}
const brief = {
  ...base,
  execution: {
    engine: "v1" as const,
    agent: "michael",
    model: { id: "test-model", providerID: "test", variant: "default" },
    mode: "native" as const,
    maxCalls: 20,
    wallClockMs: 900_000,
  },
}

test("advertises one structured brief object with a required execution snapshot", () => {
  const schema = TaskDispatchV1.jsonSchema
  const properties = schema.properties
  const advertised =
    properties && typeof properties === "object" && !Array.isArray(properties) ? properties.brief : undefined
  expect(schema.required).toEqual(["dispatchKey", "brief"])
  if (typeof advertised !== "object" || advertised === null || Array.isArray(advertised))
    throw new Error("brief is not advertised as an object schema")
  expect(advertised.type).toBe("object")
  expect(advertised.anyOf).toBeUndefined()
  expect(advertised.required).toEqual(
    expect.arrayContaining(["title", "objective", "scope", "output", "checks", "constraints", "execution"]),
  )
})

test("dispatch accepts a provider-serialized brief while still validating its full shape", () => {
  const decode = Schema.decodeUnknownSync(TaskDispatchV1.Parameters)
  expect(decode({ dispatchKey: "weather", brief: JSON.stringify(brief) }).brief).toEqual(brief)
  expect(decode({ dispatchKey: "weather", brief }).brief).toEqual(brief)
  expect(() => decode({ dispatchKey: "weather", brief: "not json" })).toThrow()
  expect(() => decode({ dispatchKey: "weather", brief: JSON.stringify({ ...brief, checks: [] }) })).toThrow()
})

test("rejects a brief without the execution snapshot the host needs to run it", () => {
  const decode = Schema.decodeUnknownSync(TaskDispatchV1.Parameters)
  expect(() => decode({ dispatchKey: "weather", brief: base })).toThrow()
  expect(() => decode({ dispatchKey: "weather", brief: JSON.stringify(base) })).toThrow()
})
