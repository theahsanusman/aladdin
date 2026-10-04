import { randomBytes, randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import { join } from "node:path"
import type { BrowserContext, Dialog, Locator, Page } from "playwright-core"
import { BrowserError, requests, type Request, type target } from "./contracts.ts"
import { browserEnvironment, browserVersion, ProfileStore, secureDirectory } from "./profiles.ts"
import type { z } from "zod"

export type BrowserSettings = { root: string; executable: string }

export class BrowserManager {
  readonly store: ProfileStore
  readonly contexts = new Map<string, BrowserContext>()
  readonly pages = new Map<string, { profile: string; page: Page }>()
  readonly dialogs = new Map<Page, Dialog>()
  readonly queues = new Map<string, Promise<unknown>>()
  private nextTab = 0
  private pending = 0
  private readonly epoch = randomBytes(8).toString("hex")

  constructor(readonly settings: BrowserSettings) {
    this.store = new ProfileStore(settings.root)
  }

  context(profile: string) {
    const context = this.contexts.get(profile)
    if (!context) throw new BrowserError("closed")
    return context
  }

  async execute(input: unknown) {
    const request = requests.parse(input)
    if (request.action === "profiles" && request.operation === "list") return { profiles: await this.store.list() }
    if (this.pending >= 32) throw new BrowserError("busy")
    this.pending++
    const admitted = Date.now()
    const previous = this.queues.get(request.profile) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => {
        if (Date.now() - admitted > 20000) throw new BrowserError("busy")
        return this.perform(request)
      })
    this.queues.set(request.profile, next)
    try {
      return await next
    } finally {
      this.pending--
      if (this.queues.get(request.profile) === next) this.queues.delete(request.profile)
    }
  }

  async closeAll() {
    await Promise.allSettled([...this.queues.values()])
    await Promise.all([...this.contexts.values()].map((context) => context.close()))
  }

  private attach(profile: string, page: Page) {
    if ([...this.pages.values()].some((item) => item.page === page)) return
    const id = `t${this.epoch}-${++this.nextTab}`
    this.pages.set(id, { profile, page })
    page.on("close", () => {
      this.pages.delete(id)
      this.dialogs.delete(page)
    })
    // Leave dialogs visible for the human or the explicit dialog tool.
    page.on("dialog", (dialog) => this.dialogs.set(page, dialog))
    page.on("download", (download) => {
      const file = join(
        this.settings.root,
        "profiles",
        profile,
        "downloads",
        `${randomUUID()}-${download
          .suggestedFilename()
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(0, 120)}`,
      )
      void download.saveAs(file).catch(() => undefined)
    })
  }

  private page(request: { profile: string; tab: string }) {
    const item = this.pages.get(request.tab)
    if (!item || item.profile !== request.profile || item.page.isClosed()) throw new BrowserError("tab")
    return item.page
  }

  private locator(page: Page, selection: z.infer<typeof target>): Locator {
    if (selection.kind === "role")
      return page.getByRole(selection.role, { name: selection.name, exact: selection.exact })
    if (selection.kind === "label") return page.getByLabel(selection.value, { exact: selection.exact })
    if (selection.kind === "text") return page.getByText(selection.value, { exact: selection.exact })
    return page.locator(selection.value)
  }

  private async perform(request: Request): Promise<unknown> {
    if (request.action === "profiles") {
      if (request.operation === "close") {
        await this.contexts.get(request.profile)?.close()
        return { profile: request.profile, open: false }
      }
      if (this.contexts.has(request.profile)) {
        if (request.operation === "open") await this.context(request.profile).pages()[0]?.bringToFront()
        return { profile: request.profile, open: true }
      }
      const { Camoufox, getRandomPreset } = await import("@camoufox/camoufox")
      const profile = await this.store.ensure(request.profile, () => {
        const preset = getRandomPreset("macos", browserVersion.split(".")[0])
        if (!preset) throw new Error("No matching Camoufox fingerprint preset is bundled")
        return preset
      })
      if (request.operation === "create") return { profile: request.profile, open: false }
      const context = await Camoufox({
        executable_path: this.settings.executable,
        headless: false,
        persistent_context: true,
        user_data_dir: join(profile.directory, "browser"),
        fingerprint_preset: profile.identity,
        // The pinned TS launcher looks beside the binary for application.ini;
        // macOS keeps it in ../Resources, so pass the verified release's major.
        ff_version: browserVersion.split(".")[0],
        i_know_what_im_doing: true,
        os: "macos",
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        config: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        humanize: true,
        geoip: false,
        exclude_addons: ["UBO"],
        disable_coop: false,
        block_webrtc: false,
        block_webgl: false,
        main_world_eval: false,
        env: browserEnvironment(process.env),
        firefox_user_prefs: {
          "toolkit.telemetry.enabled": false,
          "toolkit.telemetry.unified": false,
          "datareporting.healthreport.uploadEnabled": false,
          "datareporting.policy.dataSubmissionEnabled": false,
          "browser.crashReports.unsubmittedCheck.autoSubmit2": false,
          "extensions.getAddons.showPane": false,
          "signon.rememberSignons": false,
          "permissions.default.camera": 2,
          "permissions.default.microphone": 2,
          "permissions.default.geo": 2,
        },
        viewport: null,
        acceptDownloads: true,
        timeout: 45000,
      })
      context.setDefaultTimeout(15000)
      context.setDefaultNavigationTimeout(30000)
      this.contexts.set(request.profile, context)
      context.on("page", (page) => this.attach(request.profile, page))
      context.on("close", () => {
        this.contexts.delete(request.profile)
        for (const [id, item] of this.pages) {
          if (item.profile !== request.profile) continue
          this.dialogs.delete(item.page)
          this.pages.delete(id)
        }
      })
      context.pages().forEach((page) => this.attach(request.profile, page))
      if (!context.pages().length) await context.newPage()
      await context.pages()[0]!.bringToFront()
      return { profile: request.profile, open: true, headed: true }
    }
    const context = this.context(request.profile)
    if (request.action === "tabs") {
      if (request.operation === "new") {
        const page = await context.newPage()
        if (request.url) await page.goto(request.url, { waitUntil: "domcontentloaded" })
        await page.bringToFront()
      }
      if (["close", "focus"].includes(request.operation)) {
        if (!request.tab) throw new BrowserError("tab")
        const page = this.page({ profile: request.profile, tab: request.tab })
        if (request.operation === "close") await page.close()
        if (request.operation === "focus") await page.bringToFront()
      }
      return {
        profile: request.profile,
        tabs: await Promise.all(
          [...this.pages.entries()]
            .filter(([, item]) => item.profile === request.profile)
            .map(async ([id, item]) => ({ id, title: (await item.page.title()).slice(0, 500), url: item.page.url() })),
        ),
      }
    }
    const page = this.page(request)
    if (request.action === "navigate") {
      await page.goto(request.url, { waitUntil: "domcontentloaded" })
      return { url: page.url(), title: await page.title() }
    }
    if (request.action === "snapshot") {
      const snapshot = await page.locator("body").ariaSnapshot({ timeout: 10000 })
      const passwords = await page
        .locator('input[type="password"]')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value).filter(Boolean))
      const redacted = passwords.reduce((text, password) => text.split(password).join("[password redacted]"), snapshot)
      return {
        url: page.url(),
        title: await page.title(),
        snapshot: redacted.slice(0, 30000),
        truncated: redacted.length > 30000,
      }
    }
    if (request.action === "screenshot")
      return {
        image: (await page.screenshot({ type: "png", timeout: 10000 })).toString("base64"),
        mimeType: "image/png",
      }
    if (request.action === "click") await this.locator(page, request.target).click()
    if (request.action === "type") {
      if (!request.target) await page.keyboard.insertText(request.text)
      if (request.target) {
        const locator = this.locator(page, request.target)
        if (request.mode === "fill") await locator.fill(request.text)
        if (request.mode === "append") await locator.pressSequentially(request.text, { delay: 40 })
      }
    }
    if (request.action === "press") {
      if (request.target) await this.locator(page, request.target).press(request.key)
      if (!request.target) await page.keyboard.press(request.key)
    }
    if (request.action === "select") await this.locator(page, request.target).selectOption(request.values)
    if (request.action === "scroll") await page.mouse.wheel(request.x, request.y)
    if (request.action === "mouse") {
      await page.bringToFront()
      if (request.operation === "move") await page.mouse.move(request.x, request.y)
      if (request.operation === "click") await page.mouse.click(request.x, request.y)
      if (request.operation === "drag") {
        if (request.endX === undefined || request.endY === undefined) throw new BrowserError("protocol")
        await page.mouse.move(request.x, request.y)
        await page.mouse.down()
        try {
          await page.mouse.move(request.endX, request.endY, { steps: 15 })
        } finally {
          await page.mouse.up()
        }
      }
    }
    if (request.action === "upload") {
      await secureDirectory(join(this.settings.root, "profiles", request.profile, "uploads"))
      const files = await Promise.all(
        request.files.map(async (name) => {
          const path = join(this.settings.root, "profiles", request.profile, "uploads", name)
          const info = await lstat(path)
          if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.())
            throw new BrowserError("protocol")
          return path
        }),
      )
      await this.locator(page, request.target).setInputFiles(files)
    }
    if (request.action === "wait")
      await this.locator(page, request.target).waitFor({ state: request.state, timeout: request.milliseconds })
    if (request.action === "dialog") {
      const dialog = this.dialogs.get(page)
      if (!dialog) throw new BrowserError("dialog")
      this.dialogs.delete(page)
      if (request.operation === "accept") await dialog.accept(request.text)
      if (request.operation === "dismiss") await dialog.dismiss()
    }
    return { completed: true }
  }
}
