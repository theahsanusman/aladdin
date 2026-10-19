import { expect, test } from "@playwright/test"
import { checksum } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"

const directory = "/tmp/aladdin-background-queue"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const sessions = Array.from({ length: 5 }, (_, index) => ({
  id: `ses_background_${index}`,
  slug: `background-${index}`,
  projectID: "proj_background_queue",
  directory,
  title: `Background chat ${index + 1}`,
  version: "dev",
  time: { created: 1700000000000 + index, updated: 1700000000000 + index },
}))

test("remembered workspaces with empty or paused queues do not start MCP services", async ({ page }) => {
  const projects = Array.from({ length: 5 }, (_, index) => ({
    id: `proj_idle_${index}`,
    worktree: `${directory}-${index}`,
    vcs: "git",
    time: sessions[0].time,
    sandboxes: [],
  }))
  const mcpRequests: string[] = []
  await mockOpenCodeServer(page, {
    directory,
    provider: fixture.provider,
    project: projects[0],
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(
    (url) => url.pathname === "/project",
    (route) => route.fulfill({ json: projects }),
  )
  await page.route(
    (url) => url.pathname === "/mcp" || url.pathname === "/api/mcp",
    (route) => {
      mcpRequests.push(route.request().url())
      return route.fulfill({ json: {} })
    },
  )
  await page.addInitScript(
    ({ directory, projects, sessions, storage }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: projects.map((project) => ({ ...project, expanded: true })) } }),
      )
      localStorage.setItem(
        `${storage}:workspace:followup`,
        JSON.stringify({
          items: {
            [sessions[0].id]: [
              {
                id: "paused-draft",
                sessionID: sessions[0].id,
                sessionDirectory: directory,
                prompt: [{ type: "text", content: "Stay paused", start: 0, end: 11 }],
                context: [],
                agent: "build",
                model: { providerID: "opencode", modelID: "claude-opus-4-6" },
              },
            ],
          },
          paused: { [sessions[0].id]: true },
          failed: {},
          edit: {},
        }),
      )
      localStorage.setItem("opencode.global.dat:followup-directories", JSON.stringify({ items: [directory] }))
    },
    {
      directory,
      projects,
      sessions,
      storage: `opencode.workspace.${directory.slice(0, 12).replace(/[^a-zA-Z0-9._-]/g, "-")}.${checksum(directory)}.dat`,
    },
  )
  await page.clock.install()
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await expect(page.getByText("aladdin-background-queue-4", { exact: true })).toBeVisible()
  await page.clock.fastForward(20_000)
  expect(mcpRequests).toEqual([])
})

for (const start of ["home", "another-chat"] as const) {
  test(`five existing queues drain in order while viewing ${start}`, async ({ page }) => {
    const received: { sessionID: string; messageID: string; text: string }[] = []
    const commands: string[] = []
    const busy = new Set([sessions[0].id])
    await mockOpenCodeServer(page, {
      directory,
      provider: fixture.provider,
      project: { id: sessions[0].projectID, worktree: directory, vcs: "git", time: sessions[0].time, sandboxes: [] },
      sessions,
      pageMessages: () => ({ items: [] }),
      sessionStatus: () => Object.fromEntries([...busy].map((id) => [id, { type: "busy" }])),
    })
    await page.route(
      (url) => url.pathname === "/command",
      (route) => route.fulfill({ json: [{ name: "test", template: "Run the requested task" }] }),
    )
    await page.route(
      (url) => /^\/session\/[^/]+\/(message|command)$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback()
        const body = route.request().postDataJSON()
        const sessionID = new URL(route.request().url()).pathname.split("/")[2]
        if (body.command) commands.push(body.command)
        received.push({
          sessionID,
          messageID: body.messageID,
          text: body.command ? body.arguments : body.parts[0].text,
        })
        await route.fulfill({
          json: { info: { id: `reply_${body.messageID}`, role: "assistant", sessionID }, parts: [] },
          headers: { "access-control-allow-origin": "*" },
        })
      },
    )
    const storage = `opencode.workspace.${directory.slice(0, 12).replace(/[^a-zA-Z0-9._-]/g, "-")}.${checksum(directory)}.dat`
    await page.addInitScript(
      ({ directory, server, sessions, storage }) => {
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: directory, expanded: true }] },
            lastProject: { local: directory },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify(
            sessions.map((session) => ({
              type: "session",
              server,
              sessionId: session.id,
            })),
          ),
        )
        localStorage.setItem(
          `${storage}:workspace:followup`,
          JSON.stringify({
            items: Object.fromEntries(
              sessions.map((session) => [
                session.id,
                [0, 1, 2].map((index) => ({
                  id: `msg_${session.id}_${index}`,
                  sessionID: session.id,
                  sessionDirectory: directory,
                  prompt: [
                    {
                      type: "text",
                      content: `${session.id === sessions[1].id && index === 0 ? "/test " : ""}${session.id} task ${index}`,
                      start: 0,
                      end: 30,
                    },
                  ],
                  context: [],
                  agent: "build",
                  model: { providerID: "opencode", modelID: "claude-opus-4-6" },
                })),
              ]),
            ),
            failed: {},
            paused: {},
            edit: {},
          }),
        )
      },
      { directory, server, sessions, storage },
    )
    await page.clock.install()
    await page.goto(start === "home" ? "/" : `/server/${btoa(server)}/session/${sessions[4].id}`)
    if (start === "another-chat")
      await expect(page.getByRole("heading", { name: sessions[4].title, exact: true })).toBeVisible()
    await expect.poll(() => received.length).toBe(12)
    expect(received.some((item) => item.sessionID === sessions[0].id)).toBe(false)
    busy.clear()
    await page.clock.fastForward(5_000)
    await expect.poll(() => received.length).toBe(15)
    for (const session of sessions) {
      expect(received.filter((item) => item.sessionID === session.id).map((item) => item.text)).toEqual(
        [0, 1, 2].map((index) => `${session.id} task ${index}`),
      )
    }
    expect(new Set(received.map((item) => item.messageID)).size).toBe(15)
    expect(commands).toEqual(["test"])
    expect(received.every((item) => !item.messageID.startsWith("msg_ses_background_"))).toBe(true)
    await expect
      .poll(() =>
        page.evaluate((storage) => {
          const value = JSON.parse(localStorage.getItem(`${storage}:workspace:followup`) ?? "{}")
          return Object.keys(value.items ?? {}).length
        }, storage),
      )
      .toBe(0)
    await page.clock.fastForward(15_000)
    expect(received).toHaveLength(15)
  })
}
