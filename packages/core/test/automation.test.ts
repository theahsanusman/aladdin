import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Automation } from "@opencode-ai/core/automation"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Automation.node])))

const projectID = Project.ID.make("automation-project")
const directory = AbsolutePath.make("/tmp/automation-project")

function setup() {
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: directory, sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

function createInput(overrides: Partial<Automation.CreateInput> = {}): Automation.CreateInput {
  return {
    projectID,
    directory,
    name: "Morning briefing",
    prompt: "Brief me on yesterday's commits",
    kind: "standalone",
    profile: "workspace-write",
    schedule: { type: "daily", time: "08:00" },
    verification: [{ command: "git status --porcelain" }],
    timeoutMinutes: 30,
    status: "active",
    nextRunAt: 1000,
    ...overrides,
  }
}

describe("Automation service", () => {
  it.effect("creates, lists and gets automations", () =>
    Effect.gen(function* () {
      yield* setup()
      const automation = yield* Automation.Service
      const created = yield* automation.create(createInput())

      expect(created.id.startsWith("atm_")).toBe(true)
      expect(created.name).toBe("Morning briefing")
      expect(created.profile).toBe("workspace-write")
      expect(created.time.created).toBeGreaterThan(0)

      const fetched = yield* automation.get(created.id)
      expect(fetched).toEqual(created)

      const listed = yield* automation.list(directory)
      expect(listed.map((item) => item.id)).toEqual([created.id])
      expect(yield* automation.list(AbsolutePath.make("/tmp/other"))).toEqual([])
    }),
  )

  it.effect("finds due automations only when active", () =>
    Effect.gen(function* () {
      yield* setup()
      const automation = yield* Automation.Service
      const created = yield* automation.create(createInput({ nextRunAt: 1000 }))

      expect((yield* automation.due(500)).map((item) => item.id)).toEqual([])
      expect((yield* automation.due(1000)).map((item) => item.id)).toEqual([created.id])

      yield* automation.update(created.id, { status: "paused" })
      expect(yield* automation.due(2000)).toEqual([])
    }),
  )

  it.effect("updates patches and clears nullable fields", () =>
    Effect.gen(function* () {
      yield* setup()
      const automation = yield* Automation.Service
      const created = yield* automation.create(createInput({ agent: "michael", budgetPerRunTokens: 500 }))

      const updated = yield* automation.update(created.id, {
        status: "paused",
        agent: null,
        budgetPerRunTokens: null,
        schedule: { type: "interval", minutes: 30 },
      })
      expect(updated?.status).toBe("paused")
      expect(updated?.agent).toBeUndefined()
      expect(updated?.budgetPerRunTokens).toBeUndefined()
      expect(updated?.schedule).toEqual({ type: "interval", minutes: 30 })
      expect(updated?.time.updated).toBeGreaterThanOrEqual(created.time.updated)
    }),
  )

  it.effect("removes automations and their runs", () =>
    Effect.gen(function* () {
      yield* setup()
      const automation = yield* Automation.Service
      const created = yield* automation.create(createInput())
      const run = yield* automation.createRun({ automationID: created.id, status: "queued", trigger: "schedule" })

      yield* automation.remove(created.id)
      expect(yield* automation.get(created.id)).toBeUndefined()
      const runs = yield* automation.listRuns([created.id], 10)
      expect(runs).toEqual([])
      expect(run.id.startsWith("atr_")).toBe(true)
    }),
  )

  it.effect("creates and updates runs", () =>
    Effect.gen(function* () {
      yield* setup()
      const automation = yield* Automation.Service
      const created = yield* automation.create(createInput())

      const run = yield* automation.createRun({
        automationID: created.id,
        status: "running",
        trigger: "schedule",
        scheduledFor: 1000,
        sessionID: "ses_test",
      })
      expect(run.status).toBe("running")
      expect(run.unread).toBe(false)
      expect(run.time.started).toBeGreaterThan(0)

      const finished = yield* automation.updateRun(run.id, {
        status: "done",
        outcome: "verified",
        tokensTotal: 1200,
        cost: 0.12,
        unread: true,
        timeFinished: Date.now(),
      })
      expect(finished?.outcome).toBe("verified")
      expect(finished?.tokensTotal).toBe(1200)
      expect(finished?.unread).toBe(true)

      const listed = yield* automation.listRuns([created.id], 10)
      expect(listed.map((item) => item.id)).toEqual([run.id])

      yield* automation.markRunsRead([created.id])
      const afterRead = yield* automation.listRuns([created.id], 10)
      expect(afterRead[0]?.unread).toBe(false)
    }),
  )

  it.effect("sums tokens since a timestamp", () =>
    Effect.gen(function* () {
      yield* setup()
      const automation = yield* Automation.Service
      const created = yield* automation.create(createInput())

      const first = yield* automation.createRun({ automationID: created.id, status: "done", trigger: "schedule" })
      yield* automation.updateRun(first.id, { tokensTotal: 100 })
      const second = yield* automation.createRun({ automationID: created.id, status: "done", trigger: "manual" })
      yield* automation.updateRun(second.id, { tokensTotal: 50 })

      expect(yield* automation.tokensSince(created.id, 0)).toBe(150)
      expect(yield* automation.tokensSince(created.id, Date.now() + 1000)).toBe(0)
    }),
  )
})
