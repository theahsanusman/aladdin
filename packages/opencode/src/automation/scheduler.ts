import { Automation } from "@opencode-ai/core/automation"
import { Schedule as AutomationSchedule } from "@opencode-ai/core/automation/schedule"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Context, Duration, Effect, Layer, Schedule } from "effect"
import { AutomationEngine } from "./engine"

export interface Interface {
  readonly tick: (now?: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AutomationScheduler") {}

const TICK = Duration.seconds(30)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const automation = yield* Automation.Service
    const engine = yield* AutomationEngine.Service

    const tick = Effect.fn("AutomationScheduler.tick")(function* (now = Date.now()) {
      // Anything due, however stale, runs once on the next tick: a machine that
      // was off at the scheduled time catches up when the harness starts again.
      // next_run_at advances from now, so multiple missed occurrences collapse
      // into a single catch-up run rather than replaying each one.
      const due = yield* automation.due(now)
      for (const item of due) {
        yield* Effect.gen(function* () {
          const next = AutomationSchedule.next(item.schedule, new Date(now))
          yield* automation.update(item.id, { nextRunAt: next?.getTime() ?? null })
          if (!next) {
            yield* Effect.logWarning("automation has no next occurrence", { automation: item.id })
            return
          }
          yield* engine.start({ automation: item, trigger: "schedule", scheduledFor: item.nextRunAt })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("automation scheduler entry failed", {
              automation: item.id,
              cause: Cause.pretty(cause),
            }),
          ),
        )
      }
    })

    // One failed tick must not stop scheduling until the next restart: catch,
    // log, and keep the loop alive.
    yield* tick().pipe(
      Effect.catchCause((cause) => Effect.logError("automation scheduler tick failed", { cause: Cause.pretty(cause) })),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    )

    return Service.of({ tick })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Automation.node, AutomationEngine.node],
})

export * as AutomationScheduler from "./scheduler"
