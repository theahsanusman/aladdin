import { Automation } from "@opencode-ai/core/automation"
import { Schedule as AutomationSchedule } from "@opencode-ai/core/automation/schedule"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
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
      const due = yield* automation.due(now)
      for (const item of due) {
        const next = AutomationSchedule.next(item.schedule, new Date(now))
        yield* automation.update(item.id, { nextRunAt: next?.getTime() ?? null })
        if (!next) {
          yield* Effect.logWarning("automation has no next occurrence", { automation: item.id })
          continue
        }
        yield* engine.start({ automation: item, trigger: "schedule", scheduledFor: item.nextRunAt })
      }
    })

    yield* tick().pipe(Effect.repeat(Schedule.spaced(TICK)), Effect.ignore, Effect.forkScoped)

    return Service.of({ tick })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Automation.node, AutomationEngine.node],
})

export * as AutomationScheduler from "./scheduler"
