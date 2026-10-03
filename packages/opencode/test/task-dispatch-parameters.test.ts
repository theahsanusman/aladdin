import { expect, test } from "bun:test"
import { Schema } from "effect"
import { TaskDispatchV1 } from "../src/task/dispatch-v1"

test("dispatch accepts a provider-serialized brief while still validating its full shape", () => {
  const brief = {
    title: "Weather",
    objective: "Fetch current weather",
    scope: ["Miami"],
    output: "Dated report",
    checks: ["output:nonempty"],
    constraints: ["No shell"],
  }
  const decode = Schema.decodeUnknownSync(TaskDispatchV1.Parameters)
  expect(decode({ dispatchKey: "weather", brief: JSON.stringify(brief) }).brief).toEqual(brief)
  expect(decode({ dispatchKey: "weather", brief }).brief).toEqual(brief)
  expect(() => decode({ dispatchKey: "weather", brief: "not json" })).toThrow()
  expect(() => decode({ dispatchKey: "weather", brief: JSON.stringify({ ...brief, checks: [] }) })).toThrow()
})
