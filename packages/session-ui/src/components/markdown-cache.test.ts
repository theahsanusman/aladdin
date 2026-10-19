import { beforeEach, expect, mock, test } from "bun:test"

// Bun does not implement Vite's worker URL imports. Cache operations never
// instantiate this worker; browser rendering exercises the real worker asset.
mock.module("./markdown.worker.ts?worker&url", () => ({ default: "markdown-worker" }))
const { getCachedMarkdown, touchCachedMarkdown } = await import("./markdown-cache")

beforeEach(() => {
  for (let index = 0; index <= 200; index++) {
    touchCachedMarkdown(`reset-${index}`, { raw: "", html: "", hash: "" })
  }
})

test("does not retain a rendered reply larger than the memory budget", () => {
  const small = { raw: "Small reply", html: "<p>Small reply</p>", hash: "small" }
  touchCachedMarkdown("small", small)
  touchCachedMarkdown("huge", { raw: "huge", html: "x".repeat(10 * 1024 * 1024), hash: "huge" })

  expect(getCachedMarkdown("huge") === undefined).toBe(true)
  expect(getCachedMarkdown("small")).toBe(small)
})

test("evicts old rendered replies by total memory before reaching the entry limit", () => {
  for (const key of ["first", "second", "third", "fourth"]) {
    touchCachedMarkdown(key, { raw: key, html: "x".repeat((5 * 1024 * 1024) / 2), hash: key })
  }

  expect(getCachedMarkdown("first") === undefined).toBe(true)
  expect(getCachedMarkdown("second")).toBeDefined()
  expect(getCachedMarkdown("third")).toBeDefined()
  expect(getCachedMarkdown("fourth")).toBeDefined()
})

test("replacing a large reply releases its previous memory allowance", () => {
  touchCachedMarkdown("replaced", { raw: "old", html: "x".repeat(5 * 1024 * 1024), hash: "old" })
  touchCachedMarkdown("replaced", { raw: "new", html: "new", hash: "new" })
  touchCachedMarkdown("next", { raw: "next", html: "x".repeat(5 * 1024 * 1024), hash: "next" })

  expect(getCachedMarkdown("replaced")?.raw).toBe("new")
  expect(getCachedMarkdown("next")).toBeDefined()
})

test("touching a reply preserves it across entry-count eviction", () => {
  for (let index = 0; index < 200; index++) {
    touchCachedMarkdown(`reply-${index}`, { raw: `${index}`, html: `${index}`, hash: `${index}` })
  }
  touchCachedMarkdown("reply-0", getCachedMarkdown("reply-0")!)
  touchCachedMarkdown("latest", { raw: "latest", html: "latest", hash: "latest" })

  expect(getCachedMarkdown("reply-0")).toBeDefined()
  expect(getCachedMarkdown("reply-1")).toBeUndefined()
})
