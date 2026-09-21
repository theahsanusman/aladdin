import { describe, expect } from "bun:test"
import { Automation } from "@opencode-ai/core/automation"
import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { Deferred, Effect, Layer, Option } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { AutomationEngine } from "@/automation/engine"
import { Budget } from "@/automation/budget"
import { Claim } from "@/claim/registry"
import { Unattended } from "@/automation/unattended"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { pollWithTimeout, testEffect } from "../lib/effect"

const directory = AbsolutePath.make("/tmp")
const projectID = ProjectID.make("prj_automation_test")

type State = {
  automations: Map<string, Automation.Info>
  runs: Map<string, Automation.Run>
  sessions: Session.Info[]
  prompts: SessionPrompt.PromptInput[]
}

function newState(): State {
  return { automations: new Map(), runs: new Map(), sessions: [], prompts: [] }
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
    schedule: { type: "daily", time: "09:00" },
    verification: [],
    timeoutMinutes: 30,
    status: "active",
    time: { created: Date.now(), updated: Date.now() },
    ...patch,
  }
}

function runFromCreate(input: Automation.CreateRunInput): Automation.Run {
  return {
    id: AutomationSchema.RunID.create(),
    automationID: input.automationID,
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    status: input.status,
    tokensTotal: 0,
    cost: 0,
    unread: false,
    trigger: input.trigger,
    ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor } : {}),
    time: { created: Date.now() },
  }
}

function sessionInfo(id: string, permission?: PermissionV1.Ruleset): Session.Info {
  return {
    id: SessionID.make(id),
    slug: id,
    version: "test",
    projectID,
    directory,
    title: "test session",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    permission: permission ? [...permission] : undefined,
    time: { created: Date.now(), updated: Date.now() },
  } as unknown as Session.Info
}

function assistantMessage(sessionID: string): SessionV1.WithParts {
  const sid = SessionID.make(sessionID)
  return {
    info: {
      id: "msg_test",
      role: "assistant",
      sessionID: sid,
      agent: "build",
      time: { created: Date.now() },
    } as unknown as SessionV1.Info,
    parts: [
      {
        id: "prt_test",
        type: "text",
        text: "Report: nothing to do.",
        sessionID: sid,
        messageID: "msg_test",
      } as unknown as SessionV1.Part,
    ],
  }
}

function makeLayer(state: State, options: { prompt?: (input: SessionPrompt.PromptInput) => Effect.Effect<void> } = {}) {
  const automation = Layer.mock(Automation.Service)({
    get: (id) => Effect.succeed(state.automations.get(id)),
    list: (filter) =>
      Effect.succeed(
        [...state.automations.values()].filter((item) => filter === undefined || item.directory === filter),
      ),
    due: () => Effect.succeed([]),
    update: (id, patch) =>
      Effect.sync(() => {
        const current = state.automations.get(id)
        if (!current) return undefined
        const next = { ...current, ...patch } as Automation.Info
        state.automations.set(id, next)
        return next
      }),
    remove: (id) =>
      Effect.sync(() => {
        state.automations.delete(id)
      }),
    createRun: (input) =>
      Effect.sync(() => {
        const run = runFromCreate(input)
        state.runs.set(run.id, run)
        return run
      }),
    updateRun: (id, patch) =>
      Effect.sync(() => {
        const current = state.runs.get(id)
        if (!current) return undefined
        const next: Automation.Run = {
          ...current,
          ...patch,
          time: {
            ...current.time,
            ...(patch.timeStarted !== undefined ? { started: patch.timeStarted } : {}),
            ...(patch.timeFinished !== undefined ? { finished: patch.timeFinished } : {}),
          },
        }
        state.runs.set(id, next)
        return next
      }),
    listRuns: () => Effect.succeed([...state.runs.values()]),
    markRunsRead: () => Effect.void,
    tokensSince: () => Effect.succeed(0),
  })

  const sessions = Layer.mock(Session.Service)({
    create: (input) =>
      Effect.sync(() => {
        const created = sessionInfo(`ses_auto_${state.sessions.length + 1}`, input?.permission)
        return { ...created, title: input?.title ?? created.title }
      }).pipe(
        Effect.tap((created) => Effect.sync(() => state.sessions.push(created))),
      ),
    get: (id) => Effect.succeed(sessionInfo(id)),
    findMessage: (sessionID) => Effect.succeed(Option.some(assistantMessage(sessionID))),
  })

  const prompts = Layer.mock(SessionPrompt.Service)({
    prompt: (input) =>
      Effect.sync(() => {
        state.prompts.push(input)
        return assistantMessage(input.sessionID)
      }).pipe(
        Effect.flatMap((message) =>
          (options.prompt?.(input) ?? Effect.void).pipe(Effect.as(message)),
        ),
      ),
  })

  const store = Layer.mock(InstanceStore.Service)({
    provide: (_input, effect) => effect,
  })

  const events = Layer.succeed(
    EventV2Bridge.Service,
    EventV2Bridge.Service.of({ publish: () => Effect.void } as unknown as EventV2.Interface),
  )

  return LayerNode.compile(AutomationEngine.node, [
    [Automation.node, automation],
    [Session.node, sessions],
    [SessionPrompt.node, prompts],
    [InstanceStore.node, store],
    [EventV2Bridge.node, events],
  ])
}

const it = testEffect(Layer.empty)

describe("automation engine", () => {
  it.live("runs a standalone automation, verifies it, and records the run", () =>
    Effect.gen(function* () {
      const state = newState()
      const info = automationInfo({ verification: [{ command: "true" }] })
      state.automations.set(info.id, info)

      yield* Effect.gen(function* () {
        const engine = yield* AutomationEngine.Service
        const queued = yield* engine.start({ automation: info, trigger: "manual" })
        expect(queued.status).toBe("queued")

        const finished = yield* pollWithTimeout(
          Effect.sync(() => {
            const run = state.runs.get(queued.id)
            return run?.time.finished ? run : undefined
          }),
          "run never finished",
        )

        expect(finished).toMatchObject({ status: "done", outcome: "verified", unread: true })
        expect(finished.summary).toContain("Verification passed")
        expect(finished.evidence).toContain("$ true")
        expect(state.sessions).toHaveLength(1)
        expect(state.sessions[0].title).toBe("[auto] Nightly report")
        expect(state.sessions[0].permission?.length).toBeGreaterThan(0)
        expect(state.prompts).toHaveLength(1)
        expect(state.prompts[0].parts[0]).toMatchObject({ type: "text", text: info.prompt })
        expect(state.prompts[0].system).toContain("unattended scheduled automation")
        expect(state.prompts[0].system).toContain("true")
        expect(state.automations.get(info.id)?.lastRunAt).toBeGreaterThan(0)
        expect(state.automations.get(info.id)?.status).toBe("active")
        expect(Budget.isTracked(state.sessions[0].id)).toBe(false)
        expect(Unattended.isUnattended(state.sessions[0].id)).toBe(false)
        expect(Claim.list()).toEqual([])
      }).pipe(Effect.provide(makeLayer(state)))
    }),
  )

  it.live("pauses the automation when the run token budget is exceeded", () =>
    Effect.gen(function* () {
      const state = newState()
      const info = automationInfo({ budgetPerRunTokens: 10 })
      state.automations.set(info.id, info)

      yield* Effect.gen(function* () {
        const engine = yield* AutomationEngine.Service
        const queued = yield* engine.start({ automation: info, trigger: "schedule", scheduledFor: Date.now() })

        const finished = yield* pollWithTimeout(
          Effect.sync(() => {
            const run = state.runs.get(queued.id)
            return run?.time.finished ? run : undefined
          }),
          "run never finished",
        )

        expect(finished).toMatchObject({ status: "failed", outcome: "budget_exceeded" })
        expect(finished.summary).toContain("Token budget exceeded")
        expect(state.automations.get(info.id)?.status).toBe("paused")
      }).pipe(
        Effect.provide(
          makeLayer(state, {
            prompt: (input) =>
              Effect.sync(() => {
                Budget.consume(
                  input.sessionID,
                  { input: 25, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  0,
                )
              }),
          }),
        ),
      )
    }),
  )

  it.live("skips overlapping runs while the previous run is active", () =>
    Effect.gen(function* () {
      const state = newState()
      const info = automationInfo()
      state.automations.set(info.id, info)
      const gate = yield* Deferred.make<void>()

      yield* Effect.gen(function* () {
        const engine = yield* AutomationEngine.Service
        const first = yield* engine.start({ automation: info, trigger: "manual" })
        const second = yield* engine.start({ automation: info, trigger: "manual" })

        expect(second.status).toBe("skipped")
        expect(second.outcome).toBe("previous_run_active")
        expect(second.unread).toBe(false)

        yield* Deferred.succeed(gate, undefined)
        const finished = yield* pollWithTimeout(
          Effect.sync(() => {
            const run = state.runs.get(first.id)
            return run?.time.finished ? run : undefined
          }),
          "first run never finished",
        )
        expect(finished.status).toBe("done")
        // Only the completed run is unread; the skipped one is not.
        expect([...state.runs.values()].filter((run) => run.unread)).toHaveLength(1)
      }).pipe(
        Effect.provide(
          makeLayer(state, {
            prompt: () => Deferred.await(gate).pipe(Effect.asVoid),
          }),
        ),
      )
    }),
  )
})
