import { describe, expect, test } from "bun:test"
import { APP_LOOKS, appLook, defaultAppLook } from "./app-look"

describe("app look", () => {
  test("defaults to liquid glass", () => {
    expect(defaultAppLook).toBe("liquid-glass")
    expect(APP_LOOKS).toContain(defaultAppLook)
  })

  test("resolves known looks and falls back for unknown values", () => {
    expect(appLook("classic")).toBe("classic")
    expect(appLook("liquid-glass")).toBe("liquid-glass")
    expect(appLook(undefined)).toBe(defaultAppLook)
    expect(appLook(null)).toBe(defaultAppLook)
    expect(appLook("nope")).toBe(defaultAppLook)
  })
})
