import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const directory = "/tmp/mobile-stream-recovery"
const session = {
  id: "ses_mobile_recovery",
  slug: "mobile-recovery",
  projectID: "proj_mobile_recovery",
  directory,
  title: "Mobile connection verification",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

for (const recovery of ["foreground", "online", "pageshow", "disconnect", "idle", "burst", "v2-heartbeat"] as const) {
  test(`mobile live updates recover after ${recovery}`, async ({ page }) => {
    const transport = await installSseTransport<{ directory?: string; payload: Record<string, unknown> }>(page, {
      server,
      retry: 30_000,
    })
    await mockOpenCodeServer(page, {
      protocol: recovery === "v2-heartbeat" ? "v2" : "v1",
      provider: { all: [], connected: [], default: {} },
      directory,
      project: {
        id: session.projectID,
        worktree: directory,
        vcs: "git",
        name: "mobile-recovery",
        time: session.time,
        sandboxes: [],
      },
      sessions: [session],
      pageMessages: () => ({ items: [] }),
    })
    if (recovery === "idle" || recovery === "v2-heartbeat") await page.clock.install()
    await page.goto(`/server/${base64Encode(server)}/session/${session.id}`)
    await expect(page.getByRole("textbox")).toBeEditable()
    const first = await transport.waitForConnection()
    const reconnected =
      recovery === "v2-heartbeat" ? undefined : transport.waitForConnection({ after: first.id, timeout: 10_000 })

    if (recovery === "disconnect") await transport.disconnect()
    if (recovery === "foreground") await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    if (recovery === "online") await page.evaluate(() => window.dispatchEvent(new Event("online")))
    if (recovery === "pageshow")
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })))
    if (recovery === "idle") await page.clock.fastForward(35_000)
    if (recovery === "v2-heartbeat") {
      await page.clock.fastForward(35_000)
      await transport.writeRaw(": heartbeat\n\n")
    }
    if (recovery === "burst")
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"))
        document.dispatchEvent(new Event("visibilitychange"))
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))
      })

    await reconnected
    await transport.send({
      directory,
      payload: {
        id: "evt_after_recovery",
        type: "session.updated",
        properties: { info: { ...session, title: "Phone connection restored" } },
      },
    })
    await expect(page.getByRole("heading", { name: "Phone connection restored", exact: true })).toBeVisible()
    const connections = await transport.connections()
    expect(connections.filter((connection) => connection.endedAt === undefined)).toHaveLength(1)
    if (recovery === "v2-heartbeat")
      expect(connections.filter((connection) => connection.endedAt === undefined)[0]?.id).toBe(first.id)
  })
}
