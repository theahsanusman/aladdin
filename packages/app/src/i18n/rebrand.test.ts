import { describe, expect, test } from "bun:test"
import { dict } from "./en"

// Strings where "OpenCode" names the external upstream service/program
// (opencode.ai Zen free-model program), not this app. Everything else that
// names the app must say Aladdin.
const SERVICE_ATTRIBUTION = new Set([
  "dialog.model.unpaid.freeModels.title",
  "provider.connect.opencodeZen.line1",
])

describe("rebrand", () => {
  test("English app strings name Aladdin, not OpenCode", () => {
    const leaks = Object.entries(dict).filter(
      ([key, value]) => !SERVICE_ATTRIBUTION.has(key) && String(value).includes("OpenCode"),
    )
    expect(leaks).toEqual([])
  })

  test("service attribution strings keep the upstream OpenCode name", () => {
    const values = new Map(Object.entries(dict))
    for (const key of SERVICE_ATTRIBUTION) {
      expect(values.get(key)).toContain("OpenCode")
    }
  })
})
