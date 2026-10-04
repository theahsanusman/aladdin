import { afterEach, expect, test } from "bun:test"
import { connect } from "node:net"
import { lstat, mkdtemp, rm, symlink } from "node:fs/promises"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { BrowserManager } from "../src/browser.ts"
import { startBroker, requestBroker } from "../src/service.ts"

const api = { startBroker, requestBroker }
const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

async function fixture() {
  const root = await mkdtemp("/private/tmp/aladdin-ipc-test-")
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  return { root, manager: new BrowserManager({ root, executable: "/private/tmp/not-launched-by-unit-tests" }) }
}

test("two clients share one owner-only socket and profile store", async () => {
  expect(api?.startBroker).toBeDefined()
  if (!api) return
  const { root, manager } = await fixture()
  const broker = await api.startBroker(root, manager)
  cleanup.push(() => broker.close())
  expect((await lstat(join(root, "control.sock"))).mode & 0o777).toBe(0o600)
  const outputs = await Promise.all([
    api.requestBroker(root, { action: "profiles", operation: "list" }),
    api.requestBroker(root, { action: "profiles", operation: "list" }),
  ])
  expect(outputs).toEqual([{ profiles: [] }, { profiles: [] }])
  await expect(api.startBroker(root, manager)).rejects.toThrow()
})

test("the broker refuses a symlink at its control socket", async () => {
  expect(api?.startBroker).toBeDefined()
  if (!api) return
  const { root, manager } = await fixture()
  await symlink("/private/tmp/unrelated-socket", join(root, "control.sock"))
  await expect(api.startBroker(root, manager)).rejects.toThrow()
  expect((await lstat(join(root, "control.sock"))).isSymbolicLink()).toBe(true)
})

test("unvalidated IPC actions are rejected without exposing their contents", async () => {
  expect(api?.startBroker).toBeDefined()
  if (!api) return
  const { root, manager } = await fixture()
  const broker = await api.startBroker(root, manager)
  cleanup.push(() => broker.close())
  const output = await new Promise<string>((resolve, reject) => {
    const socket = connect(join(root, "control.sock"))
    socket.on("connect", () => socket.write(JSON.stringify({ action: "evaluate", secret: "do-not-echo" }) + "\n"))
    socket.on("data", (data) => {
      socket.destroy()
      resolve(data.toString())
    })
    socket.on("error", reject)
  })
  expect(output).toContain('"ok":false')
  expect(output).not.toContain("do-not-echo")
})

test("the broker holds an OS-released lock so crash recovery cannot start two profile owners", async () => {
  const { root, manager } = await fixture()
  const broker = await startBroker(root, manager)
  cleanup.push(() => broker.close())
  const lock = join(root, "broker.lock.sqlite")
  expect(
    await lstat(lock)
      .then((info) => info.mode & 0o777)
      .catch(() => undefined),
  ).toBe(0o600)
  const contender = new DatabaseSync(lock)
  try {
    expect(() => contender.exec("BEGIN EXCLUSIVE")).toThrow()
  } finally {
    contender.close()
  }
  await broker.close()
  const restarted = await startBroker(root, new BrowserManager({ root, executable: "/not-used" }))
  cleanup.push(() => restarted.close())
  expect(await requestBroker(root, { action: "profiles", operation: "list" })).toEqual({ profiles: [] })
})
