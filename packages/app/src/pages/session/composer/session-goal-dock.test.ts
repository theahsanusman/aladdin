import { describe, expect, test } from "bun:test"
import { elapsedParts, formatElapsed, goalDockState, goalProgress } from "./session-goal-dock"

describe("session goal dock", () => {
  test("shows while a goal exists in any status", () => {
    expect(goalDockState({ status: "active" })).toBe("visible")
    expect(goalDockState({ status: "paused" })).toBe("visible")
    expect(goalDockState({ status: "completed" })).toBe("visible")
  })

  test("hides when there is no goal", () => {
    expect(goalDockState(undefined)).toBe("hidden")
  })

  test("counts completed and cancelled todos as progress", () => {
    expect(goalProgress([])).toEqual({ done: 0, total: 0 })
    expect(
      goalProgress([{ status: "completed" }, { status: "cancelled" }, { status: "in_progress" }, { status: "pending" }]),
    ).toEqual({ done: 2, total: 4 })
  })

  test("splits elapsed time into seconds, minutes, and hours", () => {
    expect(elapsedParts(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 })
    expect(elapsedParts(45_000)).toEqual({ hours: 0, minutes: 0, seconds: 45 })
    expect(elapsedParts(61_000)).toEqual({ hours: 0, minutes: 1, seconds: 1 })
    expect(elapsedParts(3_725_000)).toEqual({ hours: 1, minutes: 2, seconds: 5 })
    expect(elapsedParts(-500)).toEqual({ hours: 0, minutes: 0, seconds: 0 })
  })

  test("formats elapsed time through localized unit keys", () => {
    const seen: Array<{ key: string; params: Record<string, string> }> = []
    const t = (key: string, params: Record<string, string>) => {
      seen.push({ key, params })
      return `${key}:${Object.values(params).join(",")}`
    }
    expect(formatElapsed(45_000, t)).toBe("session.goal.elapsed.seconds:45")
    expect(formatElapsed(61_000, t)).toBe("session.goal.elapsed.minutes:1,1")
    expect(formatElapsed(3_725_000, t)).toBe("session.goal.elapsed.hours:1,2")
    expect(seen.map((entry) => entry.key)).toEqual([
      "session.goal.elapsed.seconds",
      "session.goal.elapsed.minutes",
      "session.goal.elapsed.hours",
    ])
  })
})
