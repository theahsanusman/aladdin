import { beforeEach, describe, expect, test } from "bun:test"
import { Budget } from "@/automation/budget"

const tokens = (input: number) => ({ input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

beforeEach(() => Budget.clear())

describe("budget tracker", () => {
  test("ignores sessions without a tracker", () => {
    expect(Budget.consume("ses_none", tokens(10), 0)).toBeUndefined()
    expect(Budget.finish("ses_none")).toBeUndefined()
  })

  test("accumulates token totals and cost", () => {
    Budget.register({ sessionID: "ses_one", runID: "atr_one", automationID: "atm_one" })
    expect(Budget.consume("ses_one", tokens(10), 0.5)).toEqual({ over: false, used: 10 })
    expect(Budget.consume("ses_one", tokens(5), 0.25)).toEqual({ over: false, used: 15 })
    expect(Budget.finish("ses_one")).toEqual({ tokensTotal: 15, cost: 0.75 })
  })

  test("counts reasoning and cache tokens", () => {
    Budget.register({ sessionID: "ses_one", runID: "atr_one", automationID: "atm_one" })
    Budget.consume("ses_one", { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } }, 0)
    expect(Budget.finish("ses_one")).toMatchObject({ tokensTotal: 15 })
  })

  test("flags and remembers a run budget overrun", () => {
    Budget.register({ sessionID: "ses_one", runID: "atr_one", automationID: "atm_one", perRunTokens: 10 })
    expect(Budget.consume("ses_one", tokens(9), 0)).toEqual({ over: false, used: 9 })
    expect(Budget.consume("ses_one", tokens(4), 0)).toEqual({ over: true, scope: "run", limit: 10, used: 13 })
    expect(Budget.finish("ses_one")).toMatchObject({
      tokensTotal: 13,
      exceeded: { scope: "run", limit: 10, used: 13 },
    })
  })

  test("flags a day budget overrun", () => {
    Budget.register({ sessionID: "ses_one", runID: "atr_one", automationID: "atm_one", remainingDayTokens: 5 })
    expect(Budget.consume("ses_one", tokens(6), 0)).toEqual({ over: true, scope: "day", limit: 5, used: 6 })
    expect(Budget.finish("ses_one")).toMatchObject({ exceeded: { scope: "day", limit: 5, used: 6 } })
  })

  test("prefers the run scope when both budgets are exceeded", () => {
    Budget.register({
      sessionID: "ses_one",
      runID: "atr_one",
      automationID: "atm_one",
      perRunTokens: 1,
      remainingDayTokens: 100,
    })
    expect(Budget.consume("ses_one", tokens(2), 0)).toMatchObject({ scope: "run" })
  })

  test("finish is idempotent and clears tracking", () => {
    Budget.register({ sessionID: "ses_one", runID: "atr_one", automationID: "atm_one" })
    expect(Budget.isTracked("ses_one")).toBe(true)
    Budget.finish("ses_one")
    expect(Budget.isTracked("ses_one")).toBe(false)
    expect(Budget.finish("ses_one")).toBeUndefined()
  })
})
