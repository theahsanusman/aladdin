import { z } from "zod"

export const profile = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
  .default("default")
export const tab = z.string().regex(/^t[a-f0-9]{16}-[0-9]+$/)
export const roles = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "option",
  "menuitem",
  "tab",
  "searchbox",
  "heading",
  "switch",
  "slider",
] as const
export const target = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("role"),
      role: z.enum(roles),
      name: z.string().max(500),
      exact: z.boolean().default(true),
    })
    .strict(),
  z.object({ kind: z.literal("label"), value: z.string().max(500), exact: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().max(500), exact: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal("selector"), value: z.string().min(1).max(2000) }).strict(),
])

export function webURL(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Only web URLs without embedded credentials are supported")
  return url.href
}

const url = z
  .string()
  .min(1)
  .max(8192)
  .transform((value, ctx) => {
    try {
      return webURL(value)
    } catch {
      ctx.addIssue({ code: "custom", message: "Use an HTTP or HTTPS URL without embedded credentials" })
      return z.NEVER
    }
  })

export const shapes = {
  profiles: z.object({ operation: z.enum(["list", "create", "open", "close"]), profile }).strict(),
  tabs: z
    .object({ operation: z.enum(["list", "new", "focus", "close"]), profile, tab: tab.optional(), url: url.optional() })
    .strict(),
  navigate: z.object({ profile, tab, url }).strict(),
  snapshot: z.object({ profile, tab }).strict(),
  click: z.object({ profile, tab, target }).strict(),
  type: z
    .object({
      profile,
      tab,
      target: target.optional(),
      text: z.string().max(100_000),
      mode: z.enum(["fill", "append"]).default("fill"),
    })
    .strict(),
  press: z.object({ profile, tab, key: z.string().min(1).max(100), target: target.optional() }).strict(),
  select: z.object({ profile, tab, target, values: z.array(z.string().max(1000)).min(1).max(100) }).strict(),
  scroll: z
    .object({ profile, tab, x: z.number().min(-10000).max(10000).default(0), y: z.number().min(-10000).max(10000) })
    .strict(),
  wait: z
    .object({
      profile,
      tab,
      target,
      state: z.enum(["visible", "hidden"]).default("visible"),
      milliseconds: z.number().int().min(1).max(20000).default(10000),
    })
    .strict(),
  screenshot: z.object({ profile, tab }).strict(),
  dialog: z
    .object({ profile, tab, operation: z.enum(["accept", "dismiss"]), text: z.string().max(5000).optional() })
    .strict(),
  mouse: z
    .object({
      profile,
      tab,
      operation: z.enum(["click", "move", "drag"]),
      x: z.number().min(0).max(10000),
      y: z.number().min(0).max(10000),
      endX: z.number().min(0).max(10000).optional(),
      endY: z.number().min(0).max(10000).optional(),
    })
    .strict(),
  upload: z
    .object({
      profile,
      tab,
      target,
      files: z
        .array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,199}$/))
        .min(1)
        .max(10),
    })
    .strict(),
}

export const requests = z.discriminatedUnion("action", [
  shapes.profiles.extend({ action: z.literal("profiles") }),
  shapes.tabs.extend({ action: z.literal("tabs") }),
  shapes.navigate.extend({ action: z.literal("navigate") }),
  shapes.snapshot.extend({ action: z.literal("snapshot") }),
  shapes.click.extend({ action: z.literal("click") }),
  shapes.type.extend({ action: z.literal("type") }),
  shapes.press.extend({ action: z.literal("press") }),
  shapes.select.extend({ action: z.literal("select") }),
  shapes.scroll.extend({ action: z.literal("scroll") }),
  shapes.wait.extend({ action: z.literal("wait") }),
  shapes.screenshot.extend({ action: z.literal("screenshot") }),
  shapes.dialog.extend({ action: z.literal("dialog") }),
  shapes.mouse.extend({ action: z.literal("mouse") }),
  shapes.upload.extend({ action: z.literal("upload") }),
])

export type Request = z.infer<typeof requests>

export class BrowserError extends Error {
  constructor(readonly reason: "closed" | "tab" | "dialog" | "protocol" | "busy") {
    super(reason)
  }
}

export function publicError(error: unknown) {
  if (error instanceof z.ZodError) return "Invalid browser tool arguments. Check the tool schema; no action was taken."
  if (error instanceof BrowserError)
    return {
      closed: "That profile is closed. Open it with the profiles tool; Camoufox always opens a visible window.",
      tab: "That tab does not belong to the selected profile. List its tabs and use the returned ID.",
      dialog: "No dialog is waiting in that tab.",
      protocol: "The private browser service rejected the request.",
      busy: "The browser service is busy. Inspect the visible browser before retrying an action.",
    }[error.reason]
  return "Browser operation failed. Inspect the visible browser and retry; no Chrome fallback was used."
}
