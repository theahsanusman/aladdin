import type { Automation } from "@opencode-ai/schema/automation"

export type AutomationOverview = {
  readonly automations: Automation.Info[]
  readonly runs: Automation.Run[]
}

export type CreateAutomationInput = {
  name?: string
  prompt: string
  schedule: string
  kind?: Automation.Kind
  targetSessionID?: string
  agent?: string
  model?: string
  profile?: Automation.Profile
  budgetPerRunTokens?: number
  budgetPerDayTokens?: number
  verification?: string[]
  timeoutMinutes?: number
}

export type UpdateAutomationInput = Partial<CreateAutomationInput> & { status?: Automation.Status }

export function createAutomationApi(request: (path: string, init?: RequestInit) => Promise<Response>) {
  async function call<T>(directory: string, path: string, init?: RequestInit): Promise<T> {
    const url = `${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(directory)}`
    const response = await request(url, init)
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(body || `Automation request failed (${response.status})`)
    }
    return (await response.json()) as T
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    list: (directory: string) => call<AutomationOverview>(directory, "/automation"),
    create: (directory: string, payload: CreateAutomationInput) =>
      call<Automation.Info>(directory, "/automation", json(payload)),
    update: (directory: string, id: string, payload: UpdateAutomationInput) =>
      call<Automation.Info>(directory, `/automation/${encodeURIComponent(id)}`, {
        ...json(payload),
        method: "PATCH",
      }),
    remove: (directory: string, id: string) =>
      call<boolean>(directory, `/automation/${encodeURIComponent(id)}`, { method: "DELETE" }),
    run: (directory: string, id: string) =>
      call<Automation.Run>(directory, `/automation/${encodeURIComponent(id)}/run`, { method: "POST" }),
    runs: (directory: string, id: string, limit = 20) =>
      call<Automation.Run[]>(directory, `/automation/${encodeURIComponent(id)}/runs?limit=${limit}`),
    read: (directory: string) => call<boolean>(directory, "/automation/runs/read", { method: "POST" }),
  }
}

export type AutomationApi = ReturnType<typeof createAutomationApi>

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function formatSchedule(schedule: Automation.Schedule) {
  if (schedule.type === "interval") {
    if (schedule.minutes === 60) return "Hourly"
    if (schedule.minutes % 60 === 0) {
      const hours = schedule.minutes / 60
      return `Every ${hours} hour${hours === 1 ? "" : "s"}`
    }
    return `Every ${schedule.minutes} minute${schedule.minutes === 1 ? "" : "s"}`
  }
  if (schedule.type === "daily") return `Daily at ${schedule.time}`
  if (schedule.type === "weekly") {
    return `Weekly on ${WEEKDAYS[schedule.weekday] ?? "Monday"} at ${schedule.time}`
  }
  if (schedule.type === "monthly") return `Monthly on day ${schedule.day} at ${schedule.time}`
  return `Cron: ${schedule.expression}`
}

export function formatRelative(value: number | undefined, now = Date.now()) {
  if (value === undefined) return ""
  const diff = value - now
  const magnitude = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const label = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? "" : "s"}`
  const text =
    magnitude < minute
      ? "less than a minute"
      : magnitude < hour
        ? label(Math.round(magnitude / minute), "minute")
        : magnitude < day
          ? label(Math.round(magnitude / hour), "hour")
          : label(Math.round(magnitude / day), "day")
  return diff >= 0 ? `in ${text}` : `${text} ago`
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    const message = error.message.trim()
    try {
      const parsed = JSON.parse(message) as { data?: { message?: string }; message?: string }
      return parsed.data?.message ?? parsed.message ?? message
    } catch {
      return message
    }
  }
  return fallback
}
