import { expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { ServerAuth } from "./auth"

const config = (password: string, desktopToken?: string) =>
  ({
    password: Option.some(password),
    username: "opencode",
    desktopToken: desktopToken === undefined ? Option.none() : Option.some(desktopToken),
  }) satisfies ServerAuth.Info

const credentials = (password: string, username = "opencode") => ({
  username,
  password: Redacted.make(password),
})

test("scrypt hash verifies the original password and rejects a different one", () => {
  const stored = ServerAuth.hashPassword("correct horse battery staple")
  expect(stored).toStartWith("scrypt$")
  expect(stored).not.toContain("correct horse battery staple")
  expect(ServerAuth.verifyPassword("correct horse battery staple", Option.some(stored))).toBe(true)
  expect(ServerAuth.verifyPassword("wrong password entirely", Option.some(stored))).toBe(false)
})

test("two hashes of the same password differ because each uses a fresh salt", () => {
  expect(ServerAuth.hashPassword("same input")).not.toBe(ServerAuth.hashPassword("same input"))
})

test("authorized accepts a password that matches the stored hash", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials("phone typed password"), config(stored))).toBe(true)
})

test("authorized rejects a wrong password", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials("not the password"), config(stored))).toBe(false)
})

test("authorized rejects a wrong username even with the right password", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials("phone typed password", "intruder"), config(stored))).toBe(false)
})

test("authorized accepts the desktop session token without knowing the password", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials("launch-token"), config(stored, "launch-token"))).toBe(true)
})

test("authorized rejects a wrong desktop token", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials("wrong-token"), config(stored, "launch-token"))).toBe(false)
})

test("authorized falls back to password when no desktop token is configured", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials("launch-token"), config(stored))).toBe(false)
})

test("authorized rejects an empty password when auth is required", () => {
  const stored = ServerAuth.hashPassword("phone typed password")
  expect(ServerAuth.authorized(credentials(""), config(stored))).toBe(false)
})

test("verifyPassword rejects malformed stored values instead of throwing", () => {
  for (const malformed of ["", "plaintext-password", "scrypt$1$2$3$notbase64", "bcrypt$1$2$3$aa$bb"]) {
    expect(ServerAuth.verifyPassword("anything", Option.some(malformed))).toBe(false)
  }
  expect(ServerAuth.verifyPassword("anything", Option.none())).toBe(false)
})
