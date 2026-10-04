import { afterAll, expect, test } from "bun:test"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile, symlink, unlink } from "node:fs/promises"
import { join } from "node:path"
import { BrowserManager } from "../src/browser.ts"

const executable = process.env.ALADDIN_CAMOUFOX_EXECUTABLE
if (!executable)
  throw new Error("Set ALADDIN_CAMOUFOX_EXECUTABLE to the verified browser executable for headed verification")
const root = await mkdtemp("/private/tmp/aladdin-headed-test-")
const manager = new BrowserManager({ root, executable })
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" })
  response.end(
    '<!doctype html><title>Aladdin browser verification</title><h1>Visible browser test</h1><label>Password<input type="password" value="do-not-expose-this-password"></label><label>Name<input id="name"></label><label>Upload<input id="upload" type="file"></label><button id="save">Save</button><p id="result"></p><script>document.getElementById("save").onclick = () => { document.getElementById("result").textContent = document.getElementById("name").value }</script>',
  )
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("Test server did not bind")
const url = `http://127.0.0.1:${address.port}/`

afterAll(async () => {
  await manager.closeAll()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  await rm(root, { recursive: true, force: true })
})

test("real visible browser retains identity and login state without leaking into another profile", async () => {
  await manager.execute({ action: "profiles", operation: "open", profile: "test-one" })
  const context = manager.context("test-one")
  const page = context.pages()[0]!
  await page.goto(url)
  const identity = await page.evaluate(() => ({
    ua: navigator.userAgent,
    platform: navigator.platform,
    concurrency: navigator.hardwareConcurrency,
    width: screen.width,
    languages: navigator.languages,
    webdriver: navigator.webdriver,
  }))
  await context.addCookies([{ name: "session-test", value: "private-marker", url, expires: Date.now() / 1000 + 3600 }])
  await page.evaluate(() => localStorage.setItem("session-test", "private-marker"))
  const tabs = await manager.execute({ action: "tabs", operation: "list", profile: "test-one" })
  const id = (tabs as { tabs: { id: string }[] }).tabs[0]!.id
  const snapshot = await manager.execute({ action: "snapshot", profile: "test-one", tab: id })
  expect(JSON.stringify(snapshot)).not.toContain("do-not-expose-this-password")
  await manager.execute({
    action: "type",
    profile: "test-one",
    tab: id,
    mode: "fill",
    target: { kind: "label", value: "Name", exact: true },
    text: "verified",
  })
  await manager.execute({
    action: "click",
    profile: "test-one",
    tab: id,
    target: { kind: "role", role: "button", name: "Save", exact: true },
  })
  expect(await page.locator("#result").textContent()).toBe("verified")
  await page.locator("#name").focus()
  await manager.execute({ action: "type", profile: "test-one", tab: id, text: "-focused", mode: "append" })
  expect(await page.locator("#name").inputValue()).toBe("verified-focused")
  const inbox = join(root, "profiles", "test-one", "uploads")
  await writeFile(join(inbox, "test.txt"), "safe test upload", { mode: 0o600 })
  await manager.execute({
    action: "upload",
    profile: "test-one",
    tab: id,
    target: { kind: "selector", value: "#upload" },
    files: ["test.txt"],
  })
  expect(await page.locator("#upload").evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe(
    "test.txt",
  )
  await symlink(join(inbox, "test.txt"), join(inbox, "linked.txt"))
  await expect(
    manager.execute({
      action: "upload",
      profile: "test-one",
      tab: id,
      target: { kind: "selector", value: "#upload" },
      files: ["linked.txt"],
    }),
  ).rejects.toThrow()
  await unlink(join(inbox, "linked.txt"))
  const screenshot = (await manager.execute({ action: "screenshot", profile: "test-one", tab: id })) as {
    image: string
  }
  expect(Buffer.from(screenshot.image, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  expect(identity.webdriver).toBe(false)
  await manager.execute({ action: "profiles", operation: "close", profile: "test-one" })
  await manager.execute({ action: "profiles", operation: "open", profile: "test-one" })
  const reopened = manager.context("test-one").pages()[0]!
  await reopened.goto(url)
  expect(
    await reopened.evaluate(() => ({
      ua: navigator.userAgent,
      platform: navigator.platform,
      concurrency: navigator.hardwareConcurrency,
      width: screen.width,
      languages: navigator.languages,
      webdriver: navigator.webdriver,
    })),
  ).toEqual(identity)
  expect(await reopened.evaluate(() => localStorage.getItem("session-test"))).toBe("private-marker")
  expect((await manager.context("test-one").cookies(url)).find((cookie) => cookie.name === "session-test")?.value).toBe(
    "private-marker",
  )
  await manager.execute({ action: "profiles", operation: "open", profile: "test-two" })
  const other = manager.context("test-two").pages()[0]!
  await other.goto(url)
  expect(await other.evaluate(() => localStorage.getItem("session-test"))).toBeNull()
  expect(
    (await manager.context("test-two").cookies(url)).find((cookie) => cookie.name === "session-test"),
  ).toBeUndefined()
})
