import { afterEach, expect, test } from "bun:test"
import { chmod, lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { join } from "node:path"

const roots: string[] = []
import { ProfileStore, profileName, browserEnvironment, secureDirectory } from "../src/profiles.ts"
const api = { ProfileStore, profileName, browserEnvironment, secureDirectory }

async function root() {
  const result = await mkdtemp("/private/tmp/aladdin-browser-test-")
  roots.push(result)
  return result
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test("profile names cannot escape their private directory", () => {
  expect(api?.profileName("work-account")).toBe("work-account")
  for (const name of ["../Chrome", "/tmp/test", "a/b", ".hidden", "", "A", "a".repeat(41)]) {
    expect(() => api?.profileName(name)).toThrow()
  }
})

test("a profile persists one identity and uses private directories and metadata", async () => {
  expect(api?.ProfileStore).toBeDefined()
  if (!api) return
  const path = join(await root(), "browser")
  const store = new api.ProfileStore(path)
  let draws = 0
  const first = await store.ensure("default", () => ({ userAgent: "test-agent", seed: ++draws }))
  const second = await new api.ProfileStore(path).ensure("default", () => ({ seed: ++draws }))
  expect(second.identity).toEqual(first.identity)
  expect(draws).toBe(1)
  expect((await lstat(first.directory)).mode & 0o777).toBe(0o700)
  expect((await lstat(first.identityPath)).mode & 0o777).toBe(0o600)
  expect(JSON.parse(await readFile(first.identityPath, "utf8")).preset).toEqual(first.identity)
  expect(await store.list()).toEqual(["default"])
})

test("profile storage rejects symlinks instead of touching another browser", async () => {
  expect(api?.ProfileStore).toBeDefined()
  if (!api) return
  const path = await root()
  const target = join(await root(), "other-browser")
  await api.secureDirectory(target)
  await symlink(target, join(path, "profiles"))
  await expect(new api.ProfileStore(path).ensure("default", () => ({ seed: 1 }))).rejects.toThrow("symlink")
})

test("insecure existing profile metadata fails closed", async () => {
  expect(api?.ProfileStore).toBeDefined()
  if (!api) return
  const store = new api.ProfileStore(await root())
  const profile = await store.ensure("default", () => ({ seed: 1 }))
  await chmod(profile.identityPath, 0o644)
  await expect(store.ensure("default", () => ({ seed: 2 }))).rejects.toThrow("private")
})

test("browser subprocess environment excludes credentials and injection settings", () => {
  expect(
    api?.browserEnvironment({
      PATH: "/bin",
      HOME: "/Users/test",
      OPENAI_API_KEY: "secret",
      NODE_OPTIONS: "--inspect",
      CAMOU_CONFIG_1: "untrusted",
    }),
  ).toEqual({ PATH: "/bin", HOME: "/Users/test" })
})
