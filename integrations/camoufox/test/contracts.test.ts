import { expect, test } from "bun:test"

import { requests, shapes, webURL, publicError } from "../src/contracts.ts"
const api = { requests, webURL, publicError }

test("browser navigation accepts web URLs and rejects local files, code and credentials", () => {
  expect(api?.webURL("https://example.com/path")).toBe("https://example.com/path")
  expect(api?.webURL("http://127.0.0.1:43210")).toBe("http://127.0.0.1:43210/")
  for (const url of [
    "file:///Users/test/.env",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:secret@example.com",
    "about:config",
  ]) {
    expect(() => api?.webURL(url)).toThrow()
  }
})

test("tool schemas reject arbitrary code, file paths and unspecified options", () => {
  expect(api?.requests.parse({ action: "profiles", operation: "list" })).toEqual({
    action: "profiles",
    operation: "list",
    profile: "default",
  })
  expect(api?.requests.safeParse({ action: "evaluate", code: "process.env" }).success).toBe(false)
  expect(api?.requests.safeParse({ action: "profiles", operation: "open", profile: "../chrome" }).success).toBe(false)
  expect(api?.requests.safeParse({ action: "navigate", tab: "t1", url: "file:///tmp/test" }).success).toBe(false)
  expect(api?.requests.safeParse({ action: "profiles", operation: "open", headless: true }).success).toBe(false)
})

test("errors sent to the agent never echo secrets or page content", () => {
  expect(api?.publicError(new Error("secret token=abc https://example.com?q=password"))).toBe(
    "Browser operation failed. Inspect the visible browser and retry; no Chrome fallback was used.",
  )
})

test("uploads stay in the profile inbox and mouse actions cannot use invalid coordinates", () => {
  const tab = "t0123456789abcdef-1"
  expect(
    api.requests.safeParse({
      action: "upload",
      tab,
      target: { kind: "selector", value: 'input[type="file"]' },
      files: ["photo.png"],
    }).success,
  ).toBe(true)
  expect(
    api.requests.safeParse({
      action: "upload",
      tab,
      target: { kind: "selector", value: 'input[type="file"]' },
      files: ["../../.env"],
    }).success,
  ).toBe(false)
  expect(api.requests.safeParse({ action: "mouse", tab, operation: "click", x: -1, y: 50 }).success).toBe(false)
})

test("visual interaction can type into a focused control without exposing evaluation", () => {
  expect(api.requests.safeParse({ action: "type", tab: "t0123456789abcdef-1", text: "visible input" }).success).toBe(
    true,
  )
})

test("string targets explain the object contract without echoing their contents", () => {
  const result = requests.safeParse({
    action: "press",
    tab: "t0123456789abcdef-1",
    key: "Enter",
    target: '{"kind":"text","value":"private-page-secret"}',
  })
  expect(result.success).toBe(false)
  if (result.success) throw new Error("String target was accepted")
  const error = publicError(result.error)
  expect(error).toContain("target")
  expect(error).toContain("object")
  expect(error).toContain("no action was taken")
  expect(error).not.toContain("private-page-secret")
})

test("argument errors identify safe fields but never disclose unknown keys or values", () => {
  const result = requests.safeParse({
    action: "press",
    tab: "private-tab-secret",
    key: "Enter",
    "secret-key": "secret-value",
  })
  expect(result.success).toBe(false)
  if (result.success) throw new Error("Invalid arguments were accepted")
  const error = publicError(result.error)
  expect(error).toContain("tab")
  expect(error).not.toContain("private-tab-secret")
  expect(error).not.toContain("secret-key")
  expect(error).not.toContain("secret-value")
})

test("target schemas tell models to send objects rather than JSON strings", () => {
  expect(shapes.press.shape.target.unwrap().description).toContain("JSON object")
  expect(shapes.click.shape.target.description).toContain("not a string")
})
