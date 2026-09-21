import { describe, expect, test } from "bun:test"
import { Schedule } from "@opencode-ai/core/automation/schedule"

describe("Automation.Schedule.parse", () => {
  test("intervals", () => {
    expect(Schedule.parse("every 15 minutes")).toEqual({ type: "interval", minutes: 15 })
    expect(Schedule.parse("every 1 minute")).toEqual({ type: "interval", minutes: 1 })
    expect(Schedule.parse("10 mins")).toEqual({ type: "interval", minutes: 10 })
    expect(Schedule.parse("every 2 hours")).toEqual({ type: "interval", minutes: 120 })
    expect(Schedule.parse("hourly")).toEqual({ type: "interval", minutes: 60 })
    expect(Schedule.parse("every hour")).toEqual({ type: "interval", minutes: 60 })
  })

  test("daily", () => {
    expect(Schedule.parse("daily")).toEqual({ type: "daily", time: "09:00" })
    expect(Schedule.parse("daily at 08:30")).toEqual({ type: "daily", time: "08:30" })
    expect(Schedule.parse("Daily at 7")).toEqual({ type: "daily", time: "07:00" })
    expect(Schedule.parse("every day at 8am")).toEqual({ type: "daily", time: "08:00" })
    expect(Schedule.parse("daily at 11:45pm")).toEqual({ type: "daily", time: "23:45" })
  })

  test("weekly", () => {
    expect(Schedule.parse("weekly")).toEqual({ type: "weekly", weekday: 1, time: "09:00" })
    expect(Schedule.parse("weekly on monday at 09:00")).toEqual({ type: "weekly", weekday: 1, time: "09:00" })
    expect(Schedule.parse("every friday at 5pm")).toEqual({ type: "weekly", weekday: 5, time: "17:00" })
    expect(Schedule.parse("sunday at 10:00")).toBeUndefined()
  })

  test("monthly", () => {
    expect(Schedule.parse("monthly")).toEqual({ type: "monthly", day: 1, time: "09:00" })
    expect(Schedule.parse("monthly on the 15th at 07:30")).toEqual({ type: "monthly", day: 15, time: "07:30" })
    expect(Schedule.parse("monthly on 3 at 18:00")).toEqual({ type: "monthly", day: 3, time: "18:00" })
    expect(Schedule.parse("monthly on the 45th")).toBeUndefined()
  })

  test("cron", () => {
    expect(Schedule.parse("cron 0 9 * * 1-5")).toEqual({ type: "cron", expression: "0 9 * * 1-5" })
    expect(Schedule.parse("0 9 * * *")).toEqual({ type: "cron", expression: "0 9 * * *" })
    expect(Schedule.parse("*/15 * * * *")).toEqual({ type: "cron", expression: "*/15 * * * *" })
    expect(Schedule.parse("cron 0 9 * *")).toBeUndefined()
  })

  test("invalid", () => {
    expect(Schedule.parse("whenever")).toBeUndefined()
    expect(Schedule.parse("")).toBeUndefined()
    expect(Schedule.parse("every 0 minutes")).toBeUndefined()
    expect(Schedule.parse("daily at 25:00")).toBeUndefined()
    expect(Schedule.parse("weekly on smarchday")).toBeUndefined()
  })
})

describe("Automation.Schedule.format", () => {
  test("renders human text", () => {
    expect(Schedule.format({ type: "interval", minutes: 15 })).toBe("Every 15 minutes")
    expect(Schedule.format({ type: "interval", minutes: 1 })).toBe("Every 1 minute")
    expect(Schedule.format({ type: "interval", minutes: 60 })).toBe("Hourly")
    expect(Schedule.format({ type: "interval", minutes: 120 })).toBe("Every 2 hours")
    expect(Schedule.format({ type: "daily", time: "09:00" })).toBe("Daily at 09:00")
    expect(Schedule.format({ type: "weekly", weekday: 1, time: "09:00" })).toBe("Weekly on Monday at 09:00")
    expect(Schedule.format({ type: "monthly", day: 1, time: "09:00" })).toBe("Monthly on day 1 at 09:00")
    expect(Schedule.format({ type: "cron", expression: "0 9 * * *" })).toBe("Cron: 0 9 * * *")
  })
})

describe("Automation.Schedule.next", () => {
  test("interval adds minutes", () => {
    const after = new Date(2026, 0, 5, 10, 0, 0)
    expect(Schedule.next({ type: "interval", minutes: 15 }, after)!.getTime()).toBe(after.getTime() + 15 * 60_000)
  })

  test("daily rolls to tomorrow when time passed", () => {
    const next = Schedule.next({ type: "daily", time: "09:00" }, new Date(2026, 0, 5, 10, 0))
    expect([next!.getFullYear(), next!.getMonth(), next!.getDate(), next!.getHours(), next!.getMinutes()]).toEqual([
      2026, 0, 6, 9, 0,
    ])
  })

  test("daily stays today when time is ahead", () => {
    const next = Schedule.next({ type: "daily", time: "09:00" }, new Date(2026, 0, 5, 8, 0))
    expect([next!.getDate(), next!.getHours()]).toEqual([5, 9])
  })

  test("weekly finds the next weekday", () => {
    // 2026-01-05 is a Monday, 2026-01-07 a Wednesday.
    const next = Schedule.next({ type: "weekly", weekday: 1, time: "09:00" }, new Date(2026, 0, 7, 10, 0))
    expect([next!.getDate(), next!.getHours()]).toEqual([12, 9])
  })

  test("monthly rolls to the next month", () => {
    const next = Schedule.next({ type: "monthly", day: 28, time: "09:00" }, new Date(2026, 0, 28, 10, 0))
    expect([next!.getMonth(), next!.getDate(), next!.getHours()]).toEqual([1, 28, 9])
  })

  test("cron steps within the hour", () => {
    const next = Schedule.next({ type: "cron", expression: "*/15 * * * *" }, new Date(2026, 0, 5, 10, 7))
    expect([next!.getHours(), next!.getMinutes()]).toEqual([10, 15])
  })

  test("cron weekday ranges", () => {
    // Friday 2026-01-09 10:00 -> Monday 2026-01-12 09:00
    const next = Schedule.next({ type: "cron", expression: "0 9 * * 1-5" }, new Date(2026, 0, 9, 10, 0))
    expect([next!.getDate(), next!.getHours()]).toEqual([12, 9])
  })

  test("cron combines restricted day fields with OR", () => {
    // 1st of month or Monday -> from Jan 2 2026 the next match is Monday Jan 5.
    const next = Schedule.next({ type: "cron", expression: "0 0 1 * 1" }, new Date(2026, 0, 2, 10, 0))
    expect([next!.getDate(), next!.getHours()]).toEqual([5, 0])
  })

  test("cron returns undefined when impossible", () => {
    expect(Schedule.next({ type: "cron", expression: "0 0 31 2 *" }, new Date(2026, 0, 1))).toBeUndefined()
  })
})
