import { describe, expect, test } from "bun:test"
import { tokensPerSecond } from "./tokens-per-second"

describe("tokensPerSecond", () => {
  test("uses generated tokens over the completed generation window", () => {
    expect(tokensPerSecond({ tokens: 120, created: 1_000, completed: 5_000 })).toBe(30)
    expect(tokensPerSecond({ tokens: 45, created: 0, completed: 1_500 })).toBe(30)
  })

  test("rejects incomplete and invalid measurements", () => {
    expect(tokensPerSecond({ tokens: 10, created: 1_000 })).toBeUndefined()
    expect(tokensPerSecond({ tokens: 0, created: 1_000, completed: 2_000 })).toBeUndefined()
    expect(tokensPerSecond({ tokens: 10, created: 2_000, completed: 2_000 })).toBeUndefined()
    expect(tokensPerSecond({ tokens: 10, created: 5_000, completed: 4_000 })).toBeUndefined()
  })
})
