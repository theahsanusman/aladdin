import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/WorkerInspection"
const rootID = "ses_worker_inspection_root"
const workerID = "ses_worker_inspection_child"
const now = 1700000000000
const model = { id: "mimo-v2.6-flash", providerID: "commandcode", variant: "max" }

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`inspects worker jobs and opens their read-only activity at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page)
    await page.goto(href(rootID))
    await expectSessionTitle(page, "Michael Lead project")
    const dock = page.locator('[data-component="session-worker-dock"]')
    await dock.getByRole("button", { name: "Workers", exact: true }).click()
    const running = dock.locator('[data-task-id="tsk_worker_running"]')
    await expect(running.getByText("Job details", { exact: true })).toBeVisible()
    await running.getByText("Job details", { exact: true }).click()
    await expect(running.getByText("Inspect the isolated sample, preserve user files.", { exact: true })).toBeVisible()
    await expect(running.getByText("commandcode/mimo-v2.6-flash", { exact: false })).toBeVisible()
    await expect(running.getByText("Reasoning effort: max", { exact: true })).toBeVisible()
    await expect(running.getByText("Worker agent: michael", { exact: true })).toBeVisible()
    const queued = dock.locator('[data-task-id="tsk_worker_queued"]')
    await expect(queued.getByRole("button", { name: "View activity", exact: true })).toHaveCount(0)
    await expect(queued.getByText("Activity will appear when this worker starts.", { exact: true })).toBeVisible()
    await running.getByRole("button", { name: "View activity", exact: true }).click()
    await expect(page).toHaveURL(href(workerID))
    await expectSessionTitle(page, "Inspect sample files")
    await expect(page.getByText("The isolated sample passed its checks.", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Shell", exact: true })).toBeVisible()
    await expect(page.locator("code").filter({ hasText: "sample: verified" })).toBeVisible()
    await expect(page.getByText("Subagent sessions cannot be prompted.", { exact: false })).toBeVisible()
    await page.getByRole("button", { name: "Back to main session.", exact: true }).click()
    await expect(page).toHaveURL(href(rootID))
    await expectSessionTitle(page, "Michael Lead project")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  for (const direction of ["ltr", "rtl"]) {
    test(`keeps worker results collapsed after the chat at ${viewport.width}px ${direction}`, async ({ page }) => {
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.setViewportSize(viewport)
      await setup(page, { results: true })
      await page.goto(href(rootID))
      await expectSessionTitle(page, "Michael Lead project")
      await page.evaluate((value) => document.documentElement.setAttribute("dir", value), direction)
      const results = page.getByRole("region", { name: "Worker results", exact: true })
      const toggle = results.getByRole("button", { name: "3 worker results", exact: true })
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      await expect(results.locator("[data-worker-result-id]")).toHaveCount(0)
      await expect(page.getByText("A worker is inspecting the sample.", { exact: true })).toBeVisible()
      await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport()
      const placement = await results.evaluate((element) => {
        const timeline = element.previousElementSibling
        return {
          afterHistory: timeline?.hasAttribute("data-timeline-virtual-content"),
          positioned: getComputedStyle(element).position,
          height: element.getBoundingClientRect().height,
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
        }
      })
      expect(placement.afterHistory).toBe(true)
      expect(placement.positioned).toBe("static")
      expect(placement.height).toBeLessThan(130)
      expect(placement.width).toBeLessThanOrEqual(placement.viewport)
      await test.info().attach("collapsed-layout", {
        body: JSON.stringify({ ...placement, direction }),
        contentType: "application/json",
      })
      await page.screenshot({ path: test.info().outputPath("collapsed.png") })
      await toggle.focus()
      await toggle.press("Enter")
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
      const completed = results.locator('[data-worker-result-id="tsk_worker_completed"]')
      const failed = results.locator('[data-worker-result-id="tsk_worker_failed"]')
      const cancelled = results.locator('[data-worker-result-id="tsk_worker_cancelled"]')
      await expect(completed.locator("details")).toHaveJSProperty("open", false)
      await expect(failed.locator("details")).toHaveJSProperty("open", false)
      await expect(cancelled.locator(":scope > details")).toHaveJSProperty("open", false)
      await completed.getByText("Persistent result and evidence", { exact: true }).focus()
      await completed.getByText("Persistent result and evidence", { exact: true }).press("Enter")
      await expect(completed.getByText("The completed report is available.", { exact: true })).toBeVisible()
      await expect(completed.getByText("Completed: output:nonempty", { exact: true })).toBeVisible()
      await expect(completed.getByText("Not verified: Manual check", { exact: true })).toBeVisible()
      await expect(failed.locator("details")).toHaveJSProperty("open", false)
      await failed.getByText("Persistent result and evidence", { exact: true }).click()
      await expect(failed.getByText("Failed: Rejected check", { exact: true })).toBeVisible()
      await expect(completed.locator("details")).toHaveJSProperty("open", true)
      await cancelled.getByText("Persistent result and evidence", { exact: true }).click()
      await expect(
        cancelled.getByText("Task cancelled. Work already performed may remain in the project.", { exact: true }),
      ).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await toggle.click()
      await expect(results.locator("[data-worker-result-id]")).toHaveCount(0)
      await page.reload()
      await expectSessionTitle(page, "Michael Lead project")
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      expect(errors).toEqual([])
    })
  }
}

test("retains the current chat if the worker transcript is not available", async ({ page }) => {
  await setup(page, { missing: true })
  await page.goto(href(rootID))
  await expectSessionTitle(page, "Michael Lead project")
  const dock = page.locator('[data-component="session-worker-dock"]')
  await dock.getByRole("button", { name: "Workers", exact: true }).click()
  await dock
    .locator('[data-task-id="tsk_worker_running"]')
    .getByRole("button", { name: "View activity", exact: true })
    .click()
  await expect(page.getByText("Worker request failed", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(href(rootID))
})

test("shows cancellation clearly and keeps the internal trace behind technical details", async ({ page }) => {
  await setup(page, { cancelled: true })
  await page.goto(href(rootID))
  await expectSessionTitle(page, "Michael Lead project")
  await page.getByRole("button", { name: "1 worker results", exact: true }).click()
  const result = page.locator('[data-worker-result-id="tsk_worker_running"]')
  await expect(
    result.getByText("Task cancelled. Work already performed may remain in the project.", { exact: true }),
  ).not.toBeVisible()
  await result.getByText("Persistent result and evidence", { exact: true }).click()
  await expect(
    result.getByText("Task cancelled. Work already performed may remain in the project.", { exact: true }),
  ).toBeVisible()
  await expect(
    result.getByText("InterruptError: All fibers interrupted without error", { exact: false }),
  ).not.toBeVisible()
  await result.getByText("Technical details", { exact: true }).click()
  await expect(result.getByText("InterruptError: All fibers interrupted without error", { exact: false })).toBeVisible()
  const dock = page.locator('[data-component="session-worker-dock"]')
  await dock.getByRole("button", { name: "Workers", exact: true }).click()
  const row = dock.locator('[data-task-id="tsk_worker_running"]')
  await expect(
    row.getByText("Task cancelled. Work already performed may remain in the project.", { exact: true }),
  ).toBeVisible()
  await expect(
    row.getByText("InterruptError: All fibers interrupted without error", { exact: false }),
  ).not.toBeVisible()
})

async function setup(page: Page, options?: { missing?: boolean; cancelled?: boolean; results?: boolean }) {
  const session = (id: string, title: string, parentID?: string) => ({
    id,
    title,
    parentID,
    directory,
    projectID: "proj_worker_inspection",
    slug: id,
    agent: parentID ? "michael" : "michael-lead",
    model,
    version: "dev",
    time: { created: now, updated: now },
  })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_worker_inspection",
      name: "Worker inspection",
      worktree: directory,
      vcs: "git",
      sandboxes: [],
      time: { created: now, updated: now },
    },
    sessions: [
      session(rootID, "Michael Lead project"),
      ...(options?.missing ? [] : [session(workerID, "Inspect sample files", rootID)]),
    ],
    provider: {
      all: [
        {
          id: "commandcode",
          name: "Command Code",
          models: {
            "mimo-v2.6-flash": {
              id: model.id,
              name: "MiMo V2.6 Flash",
              limit: { context: 1_000_000 },
              variants: { max: {} },
            },
          },
        },
      ],
      connected: ["commandcode"],
      default: { providerID: model.providerID, modelID: model.id },
    },
    pageMessages: (id) => ({ items: messages(id) }),
  })
  await page.route(
    (url) => /\/api\/session\/[^/]+\/task-(board|interactions)$/.test(url.pathname),
    (route) => {
      const data = route.request().url().endsWith("task-interactions")
        ? { data: [] }
        : {
            data: options?.results
              ? [
                  {
                    ...task("tsk_worker_completed", "completed", workerID),
                    evidence: JSON.stringify({
                      result: {
                        summary: "The completed report is available.",
                        checks: [
                          { check: "output:nonempty", passed: true, evidence: "Host inspected the report" },
                          {
                            check: "Manual check",
                            passed: false,
                            unverified: true,
                            evidence: "Verification was skipped",
                          },
                        ],
                      },
                    }),
                  },
                  {
                    ...task("tsk_worker_failed", "failed", workerID),
                    evidence: JSON.stringify({
                      result: {
                        summary: "An actual requirement failed.",
                        checks: [
                          { check: "Rejected check", passed: false, evidence: "Verifier rejected this requirement" },
                        ],
                      },
                    }),
                  },
                  {
                    ...task("tsk_worker_cancelled", "cancelled", workerID),
                    evidence: JSON.stringify({ result: { error: "Cancelled" } }),
                  },
                ]
              : [
                  {
                    ...task("tsk_worker_running", options?.cancelled ? "cancelled" : "running", workerID),
                    ...(options?.cancelled
                      ? {
                          evidence: JSON.stringify({
                            result: {
                              error:
                                "InterruptError: All fibers interrupted without error\n    at TaskExecution.make (file:///app.asar/node.js:123)",
                            },
                            cleanup: "Stopped",
                          }),
                        }
                      : {}),
                  },
                  task("tsk_worker_queued", "queued"),
                ],
            team: { ownerSessionID: rootID, paused: false, timeUpdated: now },
            counts: options?.results
              ? { completed: 1, failed: 1, cancelled: 1 }
              : options?.cancelled
                ? { cancelled: 1, queued: 1 }
                : { running: 1, queued: 1 },
          }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(data),
      })
    },
  )
  await page.addInitScript(
    ({ directory, server, rootID }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({
          general: { newLayoutDesigns: true, shellToolPartsExpanded: true, shouldDisplayTabsToast: false },
        }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: rootID }]),
      )
    },
    { directory, server: server(), rootID },
  )
}

function task(id: string, status: "running" | "queued" | "cancelled" | "completed" | "failed", sessionID?: string) {
  return {
    task: {
      id,
      ownerSessionID: rootID,
      projectID: "proj_worker_inspection",
      location: { directory },
      dispatchKey: id,
      status,
      generation: sessionID ? 1 : 0,
      queueSequence: sessionID ? 1 : 2,
      timeCreated: now,
      timeUpdated: now,
      brief: {
        title:
          id === "tsk_worker_completed"
            ? `Review ${"longtitle".repeat(20)} مختلط`
            : sessionID
              ? "Inspect sample files"
              : "Queued follow-up",
        objective: "Inspect the isolated sample, preserve user files.",
        scope: [directory],
        output: "An evidence-backed report",
        checks: ["Read the sample"],
        constraints: ["Never change production files"],
        execution: { engine: "v1", agent: "michael", model, mode: "native", maxCalls: 20, wallClockMs: 60_000 },
      },
    },
    ...(sessionID
      ? {
          attempt: {
            id: "tat_worker_attempt",
            taskID: id,
            ownerSessionID: rootID,
            workerSessionID: sessionID,
            inputMessageID: "msg_worker_input",
            runtimeEpoch: "inspection-fixture",
            generation: 1,
            slot: 1,
          },
        }
      : {}),
  }
}

function messages(sessionID: string) {
  const userID = `msg_${sessionID}_user`
  const assistantID = `msg_${sessionID}_assistant`
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        agent: "michael",
        model: { providerID: model.providerID, modelID: model.id, variant: model.variant },
        time: { created: now },
      },
      parts: [
        {
          id: `prt_${sessionID}_user`,
          sessionID,
          messageID: userID,
          type: "text",
          text: sessionID === rootID ? "Inspect sample files in a worker." : "Read the isolated sample.",
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        parentID: userID,
        agent: "michael",
        mode: "michael",
        providerID: model.providerID,
        modelID: model.id,
        variant: model.variant,
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
        time: { created: now + 1_000, completed: now + 2_000 },
      },
      parts:
        sessionID === rootID
          ? [
              {
                id: "prt_root_text",
                sessionID,
                messageID: assistantID,
                type: "text",
                text: "A worker is inspecting the sample.",
              },
            ]
          : [
              {
                id: "prt_worker_shell",
                sessionID,
                messageID: assistantID,
                type: "tool",
                callID: "call_worker_read",
                tool: "bash",
                state: {
                  status: "completed",
                  input: { command: "cat sample.txt", description: "Inspect sample files" },
                  title: "Inspect sample files",
                  output: "sample: verified",
                  metadata: {},
                  time: { start: now + 1_000, end: now + 1_500 },
                },
              },
              {
                id: "prt_worker_text",
                sessionID,
                messageID: assistantID,
                type: "text",
                text: "The isolated sample passed its checks.",
              },
            ],
    },
  ]
}

function server() {
  return `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
}
function href(id: string) {
  return `/server/${base64Encode(server())}/session/${id}`
}
