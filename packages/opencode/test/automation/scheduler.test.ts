import { describe, expect } from "bun:test"
import { Automation } from "@opencode-ai/core/automation"
import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { Effect, Exit, Layer } from "effect"
import { AutomationEngine } from "@/automation/engine"
import { AutomationScheduler } from "@/automation/scheduler"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make("/tmp")
const projectID = ProjectID.make("prj_scheduler_test")

// Controlled "now" far in the future so the forked background tick (which uses
// Date.now()) never sees these automations as due; only our explicit tick(now)
// below drives them. This keeps the tests deterministic.
const NOW = new Date(2030, 0, 5, 1, 0).getTime()

type State = {
  automations: Map<string, Automation.Info>
  started: { id: string; trigger: string; scheduledFor?: number }[]
  updates: { id: string; nextRunAt?: number | null }[]
  startFailures: Set<string>
}

function newState(): State {
  return { automations: new Map(), started: [], updates: [], startFailures: new Set() }
}

function automationInfo(patch: Partial<Automation.Info> = {}): Automation.Info {
  return {
    id: AutomationSchema.ID.create(),
    projectID,
    directory,
    name: "Nightly report",
    prompt: "Summarize yesterday's commits",
    kind: "standalone",
    profile: "workspace-write",
    schedule: { type: "daily", time: "22:00" },
    verification: [],
    timeoutMinutes: 30,
    status: "active",
    time: { created: Date.now(), updated: Date.now() },
    ...patch,
  }
}

function makeLayer(state: State) {
  const automation = Layer.mock(Automation.Service)({
    get: (id) => Effect.succeed(state.automations.get(id)),
    list: () => Effect.succeed([...state.automations.values()]),
    due: (now) =>
      Effect.succeed(
        [...state.automations.values()].filter(
          (item) => item.status === "active" && item.nextRunAt !== undefined && item.nextRunAt <= now,
        ),
      ),
    update: (id, patch) =>
      Effect.sync(() => {
        const current = state.automations.get(id)
        if (!current) return undefined
        state.updates.push({ id, nextRunAt: patch.nextRunAt })
        const next = { ...current, ...patch } as Automation.Info
        state.automations.set(id, next)
        return next
      }),
  })

  const engine = Layer.mock(AutomationEngine.Service)({
    start: (input) =>
      Effect.sync(() => {
        state.started.push({
          id: input.automation.id,
          trigger: input.trigger,
          scheduledFor: input.scheduledFor,
        })
        if (state.startFailures.has(input.automation.id)) {
          throw new Error("engine start failed")
        }
        return { id: AutomationSchema.RunID.create() } as unknown as Automation.Run
      }),
  })

  return LayerNode.compile(AutomationScheduler.node, [
    [Automation.node, automation],
    [AutomationEngine.node, engine],
  ])
}

const it = testEffect(Layer.empty)

describe("automation scheduler", () => {
  it.live("runs a missed occurrence once on catch-up and advances next_run_at", () =>
    Effect.gen(function* () {
      const state = newState()
      // The 22:00 occurrence was missed (machine was off); by the time the
      // harness starts it is 01:00 the next day. next_run_at is set far past
      // NOW so only our explicit tick(NOW) sees it as due.
      const missed = new Date(2029, 5, 1, 22, 0).getTime()
      const info = automationInfo({ nextRunAt: missed })
      state.automations.set(info.id, info)

      yield* Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler.Service
        yield* scheduler.tick(NOW)

        // The missed run fires exactly once, attributed to its scheduled time.
        expect(state.started).toHaveLength(1)
        expect(state.started[0]).toMatchObject({ id: info.id, trigger: "schedule", scheduledFor: missed })

        // next_run_at advances to the next future occurrence after NOW
        // (today at 22:00), not from the missed time.
        expect(state.updates).toHaveLength(1)
        expect(state.updates[0].nextRunAt).toBe(new Date(2030, 0, 5, 22, 0).getTime())
        expect(state.automations.get(info.id)?.nextRunAt).toBe(new Date(2030, 0, 5, 22, 0).getTime())
      }).pipe(Effect.provide(makeLayer(state)))
    }),
  )

  it.live("skips automations that are not yet due", () =>
    Effect.gen(function* () {
      const state = newState()
      // Due at 22:00 today, which is after our controlled NOW (01:00).
      const upcoming = new Date(2030, 0, 5, 22, 0).getTime()
      const info = automationInfo({ nextRunAt: upcoming })
      state.automations.set(info.id, info)

      yield* Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler.Service
        yield* scheduler.tick(NOW)

        expect(state.started).toHaveLength(0)
        expect(state.updates).toHaveLength(0)
        expect(state.automations.get(info.id)?.nextRunAt).toBe(upcoming)
      }).pipe(Effect.provide(makeLayer(state)))
    }),
  )

  it.live("keeps running the remaining automations when one fails to start", () =>
    Effect.gen(function* () {
      const state = newState()
      const missedA = new Date(2029, 5, 1, 22, 0).getTime()
      const missedB = new Date(2029, 5, 1, 22, 0).getTime()
      const a = automationInfo({ nextRunAt: missedA })
      const b = automationInfo({ nextRunAt: missedB })
      state.automations.set(a.id, a)
      state.automations.set(b.id, b)
      // The first automation's engine.start fails; the second must still run.
      state.startFailures.add(a.id)

      yield* Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler.Service
        const exit = yield* scheduler.tick(NOW).pipe(Effect.exit)

        // The tick itself must not fail.
        expect(Exit.isSuccess(exit)).toBe(true)

        // Both were attempted; the healthy one still started.
        expect(state.started.map((s) => s.id).sort()).toEqual([a.id, b.id].sort())

        // Both had next_run_at advanced past the failure.
        expect(state.updates.map((u) => u.id).sort()).toEqual([a.id, b.id].sort())
      }).pipe(Effect.provide(makeLayer(state)))
    }),
  )
})
