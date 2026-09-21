import { Schema } from "effect"

export class BudgetExceededError extends Schema.TaggedErrorClass<BudgetExceededError>()("Automation.BudgetExceeded", {
  sessionID: Schema.String,
  scope: Schema.Literals(["run", "day"]),
  limit: Schema.Finite,
  used: Schema.Finite,
}) {}

export interface Tracker {
  runID: string
  automationID: string
  perRunTokens?: number
  remainingDayTokens?: number
  usedTokens: number
  cost: number
  exceeded?: { scope: "run" | "day"; limit: number; used: number }
}

export interface Tokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface ConsumeResult {
  over: boolean
  scope?: "run" | "day"
  limit?: number
  used: number
}

const trackers = new Map<string, Tracker>()

export function tokenTotal(tokens: Tokens) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function register(input: {
  sessionID: string
  runID: string
  automationID: string
  perRunTokens?: number
  remainingDayTokens?: number
}) {
  trackers.set(input.sessionID, {
    runID: input.runID,
    automationID: input.automationID,
    perRunTokens: input.perRunTokens,
    remainingDayTokens: input.remainingDayTokens,
    usedTokens: 0,
    cost: 0,
  })
}

export function isTracked(sessionID: string) {
  return trackers.has(sessionID)
}

export function consume(sessionID: string, tokens: Tokens, cost: number): ConsumeResult | undefined {
  const tracker = trackers.get(sessionID)
  if (!tracker) return undefined
  tracker.usedTokens += tokenTotal(tokens)
  tracker.cost += Number.isFinite(cost) ? cost : 0
  if (tracker.perRunTokens !== undefined && tracker.usedTokens > tracker.perRunTokens) {
    tracker.exceeded = { scope: "run", limit: tracker.perRunTokens, used: tracker.usedTokens }
    return { over: true, scope: "run", limit: tracker.perRunTokens, used: tracker.usedTokens }
  }
  if (tracker.remainingDayTokens !== undefined && tracker.usedTokens > tracker.remainingDayTokens) {
    tracker.exceeded = { scope: "day", limit: tracker.remainingDayTokens, used: tracker.usedTokens }
    return { over: true, scope: "day", limit: tracker.remainingDayTokens, used: tracker.usedTokens }
  }
  return { over: false, used: tracker.usedTokens }
}

export function finish(sessionID: string) {
  const tracker = trackers.get(sessionID)
  trackers.delete(sessionID)
  return tracker
    ? { tokensTotal: tracker.usedTokens, cost: tracker.cost, ...(tracker.exceeded ? { exceeded: tracker.exceeded } : {}) }
    : undefined
}

export function clear() {
  trackers.clear()
}

export * as Budget from "./budget"
