import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { disableWebPassword, loadWebPassword, resetWebPassword, webPasswordPath } from "./web-credentials"

const directories: string[] = []
const temporary = async () => {
  const directory = await mkdtemp(join(tmpdir(), "aladdin-web-password-"))
  directories.push(directory)
  return directory
}
afterEach(() => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("desktop launches reuse one private web password rather than rotating browser login", async () => {
  const directory = await temporary()
  const password = await loadWebPassword(directory)
  expect(password.length).toBeGreaterThanOrEqual(32)
  expect(await loadWebPassword(directory)).toBe(password)
  expect(await readFile(webPasswordPath(directory), "utf8")).toBe(password)
  if (process.platform !== "win32") expect((await stat(webPasswordPath(directory))).mode & 0o777).toBe(0o600)
})

test("concurrent starts agree on one fully written password", async () => {
  const directory = await temporary()
  const passwords = await Promise.all(Array.from({ length: 12 }, () => loadWebPassword(directory)))
  expect(new Set(passwords).size).toBe(1)
})

test("explicit reset atomically replaces credentials and subsequent launches retain them", async () => {
  const directory = await temporary()
  const previous = await loadWebPassword(directory)
  const next = await resetWebPassword(directory, "new-private-test-password")
  expect(next).not.toBe(previous)
  expect(await loadWebPassword(directory)).toBe("new-private-test-password")
  expect((await stat(webPasswordPath(directory))).mode & 0o777).toBe(0o600)
})

test("explicit passwordless preference survives launches without changing the saved credential", async () => {
  const directory = await temporary()
  const password = await loadWebPassword(directory)
  await disableWebPassword(directory)
  expect(await loadWebPassword(directory)).toBe("")
  expect(await loadWebPassword(directory)).toBe("")
  expect(await readFile(webPasswordPath(directory), "utf8")).toBe(password)
  expect((await stat(join(directory, "aladdin-web-no-password"))).mode & 0o777).toBe(0o600)
})

test("resetting a password re-enables authentication after passwordless access", async () => {
  const directory = await temporary()
  await writeFile(join(directory, "aladdin-web-no-password"), "disabled", { mode: 0o600 })
  await resetWebPassword(directory, "new-private-test-password")
  expect(await loadWebPassword(directory)).toBe("new-private-test-password")
  await expect(stat(join(directory, "aladdin-web-no-password"))).rejects.toThrow()
})

test("empty credentials fail closed and invalid reset preserves the previous password", async () => {
  const directory = await temporary()
  const password = await loadWebPassword(directory)
  for (const invalid of ["", "short", "password-with\ncontrol-character"]) {
    await expect(resetWebPassword(directory, invalid)).rejects.toThrow()
    expect(await loadWebPassword(directory)).toBe(password)
  }
  await writeFile(webPasswordPath(directory), "")
  await expect(loadWebPassword(directory)).rejects.toThrow()
})

test("reset command uses private stdin and never prints the password", async () => {
  const directory = await temporary()
  const child = Bun.spawn(
    [process.execPath, "scripts/reset-web-password.ts", `--directory=${directory}`, "--password-stdin"],
    {
      cwd: import.meta.dirname + "/../..",
      stdin: new Blob(["private-cli-test-password\n"]),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code).toBe(0)
  expect(await loadWebPassword(directory)).toBe("private-cli-test-password")
  expect(output + error).not.toContain("private-cli-test-password")
  expect(output).toContain("Username: opencode")
})
