import type { Automation } from "@opencode-ai/core/automation"
import { Effect } from "effect"

export interface StartInput {
  automation: Automation.Info
  trigger: "schedule" | "manual"
  scheduledFor?: number
}

export interface Starter {
  readonly start: (input: StartInput) => Effect.Effect<Automation.Run>
}

// The engine registers itself when its layer is built. Keeping this bridge in a
// leaf module lets the agent tool trigger runs without importing the engine
// (engine -> session prompt -> tool registry -> engine would be a cycle).
let starter: Starter | undefined

export function register(next: Starter) {
  starter = next
}

export function available() {
  return starter !== undefined
}

/** Test hook: drops the process-wide registration so suites can exercise the unavailable path. */
export function clear() {
  starter = undefined
}

export function run(input: StartInput) {
  if (!starter) return Effect.fail(new Error("The automation engine is not running"))
  return starter.start(input)
}

export * as AutomationTrigger from "./trigger"
