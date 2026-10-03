import { expect, test } from "bun:test"
import { Option } from "effect"
import { browserAuthorized, browserCookie } from "@opencode-ai/server/auth"

const config = { username: "opencode", password: Option.some("private-test-password") }
test("paired browser login persists and survives an app restart with the same credentials", () => {
  const cookie = browserCookie(config)
  expect(cookie).toContain("Max-Age=2592000")
  expect(cookie).toContain("Secure; HttpOnly; SameSite=Strict")
  expect(
    browserAuthorized(
      { cookie, host: "localhost:47820", "sec-fetch-site": "same-origin" },
      {
        username: "opencode",
        password: Option.some("private-test-password"),
      },
    ),
  ).toBe(true)
})
test("password reset revokes old browser login and sibling origins cannot use the ambient cookie", () => {
  const cookie = browserCookie(config)
  expect(browserAuthorized({ cookie }, { ...config, password: Option.some("new-private-test-password") })).toBe(false)
  expect(browserAuthorized({ cookie, "sec-fetch-site": "same-site" }, config)).toBe(false)
  expect(browserAuthorized({ cookie, host: "localhost:47820", origin: "https://other.local:47820" }, config)).toBe(
    false,
  )
})
