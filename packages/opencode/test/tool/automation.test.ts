import { afterEach, beforeEach, describe, expect } from "bun:test"
import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Automation } from "@opencode-ai/core/automation"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect } from "effect"
import { AutomationTool } from "@/tool/automation"
import { AutomationTrigger } from "@/automation/trigger"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Automation.node, EventV2Bridge.node, Truncate.node, Agent.node])),
)

// Other suites build real engine layers in the same process, so reset the
// process-wide trigger bridge to keep the unavailable path deterministic.
beforeEach(() => AutomationTrigger.clear())

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function makeContext() {
  const asks: Array<{ permission: string; patterns: string[] }> = []
  return {
    asks,
    ctx: {
      sessionID: SessionID.make("ses_test-automation"),
      messageID: MessageID.make("msg_test-automation"),
      callID: "call_test-automation",
      agent: "build",
      abort: AbortSignal.any([]),
      messages: [],
      metadata: () => Effect.void,
      ask: (input: Omit<PermissionV1.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          asks.push({ permission: input.permission, patterns: [...input.patterns] })
        }),
    },
  }
}

describe("tool.automation", () => {
  it.instance("creates, lists, gets, updates, pauses, resumes, and deletes", () =>
    Effect.gen(function* () {
      const info = yield* AutomationTool
      const tool = yield* info.init()
      const { asks, ctx } = makeContext()

      const created = yield* tool.execute(
        { action: "create", name: "Nightly", prompt: "Do the thing", schedule: "daily at 08:00" },
        ctx,
      )
      expect(created.title).toBe("Automation created: Nightly")
      const createdJson = JSON.parse(created.output)
      expect(createdJson.id.startsWith("atm_")).toBe(true)
      expect(createdJson).toMatchObject({ name: "Nightly", schedule: "Daily at 08:00", profile: "workspace-write" })
      expect(createdJson.nextRunAt).toBeGreaterThan(0)
      expect(asks).toEqual([{ permission: "automation", patterns: ["create"] }])

      const listed = yield* tool.execute({ action: "list" }, ctx)
      expect(listed.title).toBe("1 automation")
      expect(JSON.parse(listed.output)).toEqual([
        {
          id: createdJson.id,
          name: "Nightly",
          schedule: "Daily at 08:00",
          nextRunAt: createdJson.nextRunAt,
          status: "active",
          profile: "workspace-write",
          kind: "standalone",
        },
      ])
      // Read-only actions do not ask for permission.
      expect(asks).toHaveLength(1)

      const got = yield* tool.execute({ action: "get", id: createdJson.id }, ctx)
      expect(got.title).toBe("Nightly")
      const gotJson = JSON.parse(got.output)
      expect(gotJson.scheduleText).toBe("Daily at 08:00")
      expect(gotJson.runs).toEqual([])
      expect(asks).toHaveLength(1)

      const updated = yield* tool.execute(
        { action: "update", id: createdJson.id, prompt: "Do the other thing", schedule: "every 30 minutes" },
        ctx,
      )
      expect(updated.title).toBe("Nightly updated")
      expect(JSON.parse(updated.output)).toMatchObject({
        prompt: "Do the other thing",
        schedule: { type: "interval", minutes: 30 },
      })
      expect(asks.at(-1)?.patterns).toEqual(["update"])

      const paused = yield* tool.execute({ action: "pause", id: createdJson.id }, ctx)
      expect(JSON.parse(paused.output).status).toBe("paused")

      const resumed = yield* tool.execute({ action: "resume", id: createdJson.id }, ctx)
      const resumedJson = JSON.parse(resumed.output)
      expect(resumedJson.status).toBe("active")
      expect(resumedJson.nextRunAt).toBeGreaterThan(0)

      const removed = yield* tool.execute({ action: "delete", id: createdJson.id }, ctx)
      expect(removed.title).toBe("Deleted: Nightly")
      expect(JSON.parse(removed.output)).toEqual({ id: createdJson.id })
      expect((yield* tool.execute({ action: "list" }, ctx)).title).toBe("0 automations")
    }),
  )

  it.instance("reports missing automations and invalid input as tool errors", () =>
    Effect.gen(function* () {
      const info = yield* AutomationTool
      const tool = yield* info.init()
      const { ctx } = makeContext()

      const missing = yield* tool.execute({ action: "get", id: "atm_missing" }, ctx)
      expect(missing.title).toBe("Automation error")
      expect(missing.output).toBe("Automation not found: atm_missing")

      const invalid = yield* tool.execute({ action: "create", prompt: "No schedule" }, ctx)
      expect(invalid.title).toBe("Automation error")
      expect(invalid.output).toBe("A valid schedule is required to create an automation")

      const noPrompt = yield* tool.execute({ action: "create", schedule: "daily at 09:00" }, ctx)
      expect(noPrompt.output).toBe("A prompt is required to create an automation")
    }),
  )

  // This test registers the process-wide trigger bridge, so it must run after
  // the unavailable-path coverage above.
  it.instance("starts a manual run through the trigger bridge", () =>
    Effect.gen(function* () {
      const info = yield* AutomationTool
      const tool = yield* info.init()
      const { asks, ctx } = makeContext()

      const created = yield* tool.execute(
        { action: "create", name: "Manual", prompt: "Run now", schedule: "hourly" },
        ctx,
      )
      const createdJson = JSON.parse(created.output)

      const unavailable = yield* tool.execute({ action: "run", id: createdJson.id }, ctx)
      expect(unavailable.title).toBe("Automation engine unavailable")
      expect(unavailable.output).toContain("not running")

      const started: AutomationTrigger.StartInput[] = []
      AutomationTrigger.register({
        start: (input) =>
          Effect.sync(() => {
            started.push(input)
            return {
              id: AutomationSchema.RunID.make("atr_fake"),
              automationID: input.automation.id,
              status: "queued",
              tokensTotal: 0,
              cost: 0,
              unread: false,
              trigger: input.trigger,
              time: { created: Date.now() },
            } satisfies Automation.Run
          }),
      })

      const triggered = yield* tool.execute({ action: "run", id: createdJson.id }, ctx)
      expect(triggered.title).toBe("Started: Manual")
      expect(JSON.parse(triggered.output)).toEqual({ runID: "atr_fake", status: "queued" })
      expect(started).toHaveLength(1)
      expect(started[0].trigger).toBe("manual")
      expect(started[0].automation.id).toBe(createdJson.id)
      expect(asks.at(-1)?.patterns).toEqual(["run"])
    }),
  )
})
