export * as Schedule from "./schedule"

import { Automation } from "@opencode-ai/schema/automation"

export type Schedule = Automation.Schedule

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

const DEFAULT_TIME = "09:00"

function pad(value: number) {
  return value.toString().padStart(2, "0")
}

function timeOf(hour: number, minute: number) {
  return `${pad(hour)}:${pad(minute)}`
}

function parseClock(input: string): string | undefined {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(input.trim())
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2] ?? "0")
  const meridiem = match[3]
  if (minute > 59) return undefined
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined
    if (hour === 12) hour = 0
    if (meridiem === "pm") hour += 12
  }
  if (hour > 23) return undefined
  return timeOf(hour, minute)
}

type CronField = { values: ReadonlySet<number>; wildcard: boolean }

function parseCronField(input: string, min: number, max: number, aliases?: Record<string, number>): CronField | undefined {
  if (input === "*") return { values: new Set(range(min, max)), wildcard: true }
  const values = new Set<number>()
  for (const piece of input.split(",")) {
    const step = /^\*\/(\d+)$/.exec(piece)
    if (step) {
      const size = Number(step[1])
      if (size < 1) return undefined
      for (let value = min; value <= max; value += size) values.add(value)
      continue
    }
    const range = /^(\w+)-(\w+)$/.exec(piece)
    if (range) {
      const start = resolveFieldValue(range[1], aliases)
      const end = resolveFieldValue(range[2], aliases)
      if (start === undefined || end === undefined || start > end) return undefined
      for (let value = start; value <= end; value++) values.add(value)
      continue
    }
    const single = resolveFieldValue(piece, aliases)
    if (single === undefined) return undefined
    values.add(single)
  }
  if (values.size === 0) return undefined
  for (const value of values) if (value < min || value > max) return undefined
  return { values, wildcard: false }
}

function resolveFieldValue(input: string, aliases?: Record<string, number>) {
  const alias = aliases?.[input]
  if (alias !== undefined) return alias
  if (!/^\d+$/.test(input)) return undefined
  return Number(input)
}

function range(min: number, max: number) {
  const result: number[] = []
  for (let value = min; value <= max; value++) result.push(value)
  return result
}

export function parseCron(expression: string) {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return undefined
  const minute = parseCronField(parts[0], 0, 59)
  const hour = parseCronField(parts[1], 0, 23)
  const dom = parseCronField(parts[2], 1, 31)
  const month = parseCronField(parts[3], 1, 12)
  const dow = parseCronField(parts[4], 0, 6, cronDayAliases())
  if (!minute || !hour || !dom || !month || !dow) return undefined
  for (const value of month.values) {
    if (value < 1 || value > 12) return undefined
  }
  return { minute, hour, dom, month, dow }
}

function cronDayAliases(): Record<string, number> {
  const aliases: Record<string, number> = {}
  for (const [name, index] of Object.entries(WEEKDAY_ALIASES)) aliases[name] = index
  // Standard cron also uses 7 for Sunday.
  aliases["7"] = 0
  return aliases
}

export function parse(input: string): Schedule | undefined {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "")
  if (!text) return undefined

  const prefixed = /^cron\s+(.+)$/.exec(text)
  if (prefixed) {
    const expression = prefixed[1].trim()
    const cron = parseCron(expression)
    return cron ? { type: "cron", expression } : undefined
  }

  if (/^\S+(\s+\S+){4}$/.test(text) && text.split(" ").every((part) => /^[\d*,\-\/a-z]+$/.test(part))) {
    const cron = parseCron(text)
    if (cron) return { type: "cron", expression: text }
  }

  const intervalMinutes = /^(?:every\s+)?(\d+)\s*(?:minutes?|mins?)$/.exec(text)
  if (intervalMinutes) {
    const minutes = Number(intervalMinutes[1])
    return minutes >= 1 ? { type: "interval", minutes } : undefined
  }

  const intervalHours = /^(?:every\s+)?(\d+)\s*(?:hours?|hrs?)$/.exec(text)
  if (intervalHours) {
    const hours = Number(intervalHours[1])
    return hours >= 1 ? { type: "interval", minutes: hours * 60 } : undefined
  }

  if (/^(?:every\s+)?hour(?:ly)?$/.test(text)) return { type: "interval", minutes: 60 }

  const daily = /^(?:daily|every day|each day)(?:\s+at\s+(.+))?$/.exec(text)
  if (daily) {
    const time = daily[1] ? parseClock(daily[1]) : DEFAULT_TIME
    return time ? { type: "daily", time } : undefined
  }

  const weekly = /^weekly(?:\s+on\s+(\w+))?(?:\s+at\s+(.+))?$/.exec(text)
  if (weekly) {
    const weekday = weekly[1] ? WEEKDAY_ALIASES[weekly[1]] : 1
    if (weekday === undefined) return undefined
    const time = weekly[2] ? parseClock(weekly[2]) : DEFAULT_TIME
    return time ? { type: "weekly", weekday, time } : undefined
  }

  const everyWeekday = /^every\s+(\w+)(?:\s+at\s+(.+))?$/.exec(text)
  if (everyWeekday) {
    const weekday = WEEKDAY_ALIASES[everyWeekday[1]]
    if (weekday !== undefined) {
      const time = everyWeekday[2] ? parseClock(everyWeekday[2]) : DEFAULT_TIME
      return time ? { type: "weekly", weekday, time } : undefined
    }
  }

  const monthly = /^monthly(?:\s+on\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)?)?(?:\s+at\s+(.+))?$/.exec(text)
  if (monthly) {
    const day = monthly[1] ? Number(monthly[1]) : 1
    if (day < 1 || day > 28) return undefined
    const time = monthly[2] ? parseClock(monthly[2]) : DEFAULT_TIME
    return time ? { type: "monthly", day, time } : undefined
  }

  return undefined
}

export function format(schedule: Schedule): string {
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
    const weekday = WEEKDAYS[schedule.weekday] ?? "monday"
    return `Weekly on ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} at ${schedule.time}`
  }
  if (schedule.type === "monthly") return `Monthly on day ${schedule.day} at ${schedule.time}`
  return `Cron: ${schedule.expression}`
}

export function next(schedule: Schedule, after: Date): Date | undefined {
  if (schedule.type === "interval") {
    const interval = schedule.minutes * 60_000
    return new Date(after.getTime() + interval)
  }
  if (schedule.type === "daily") return nextDaily(schedule.time, after)
  if (schedule.type === "weekly") return nextWeekly(schedule.weekday, schedule.time, after)
  if (schedule.type === "monthly") return nextMonthly(schedule.day, schedule.time, after)
  return nextCron(schedule.expression, after)
}

function splitTime(time: string) {
  const [hour, minute] = time.split(":").map(Number)
  return { hour, minute }
}

function nextDaily(time: string, after: Date): Date {
  const { hour, minute } = splitTime(time)
  const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate(), hour, minute)
  if (candidate.getTime() > after.getTime()) return candidate
  return new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1, hour, minute)
}

function nextWeekly(weekday: number, time: string, after: Date): Date {
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset)
    if (day.getDay() !== weekday) continue
    const candidate = nextDailyOn(day, time)
    if (candidate.getTime() > after.getTime()) return candidate
  }
  const fallback = new Date(after.getFullYear(), after.getMonth(), after.getDate() + 7)
  return nextDailyOn(fallback, time)
}

function nextDailyOn(day: Date, time: string) {
  const { hour, minute } = splitTime(time)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
}

function nextMonthly(day: number, time: string, after: Date): Date {
  const { hour, minute } = splitTime(time)
  const candidate = new Date(after.getFullYear(), after.getMonth(), day, hour, minute)
  if (candidate.getTime() > after.getTime()) return candidate
  return new Date(after.getFullYear(), after.getMonth() + 1, day, hour, minute)
}

function nextCron(expression: string, after: Date): Date | undefined {
  const cron = parseCron(expression)
  if (!cron) return undefined
  const hours = [...cron.hour.values].sort((a, b) => a - b)
  const minutes = [...cron.minute.values].sort((a, b) => a - b)
  const start = new Date(after.getFullYear(), after.getMonth(), after.getDate())

  for (let offset = 0; offset <= 366 * 5; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
    const month = day.getMonth() + 1
    if (!cron.month.values.has(month)) continue
    if (!dayMatches(cron, day)) continue
    for (const hour of hours) {
      if (hour < 0 || hour > 23) continue
      for (const minute of minutes) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
        if (candidate.getTime() > after.getTime()) return candidate
      }
    }
  }
  return undefined
}

function dayMatches(cron: NonNullable<ReturnType<typeof parseCron>>, day: Date) {
  const dom = cron.dom.wildcard || cron.dom.values.has(day.getDate())
  const dow = cron.dow.wildcard || cron.dow.values.has(day.getDay())
  if (cron.dom.wildcard && cron.dow.wildcard) return true
  if (cron.dom.wildcard) return dow
  if (cron.dow.wildcard) return dom
  // Standard cron combines restricted day-of-month and day-of-week with OR.
  return dom || dow
}
