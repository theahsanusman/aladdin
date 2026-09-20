import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionGoal } from "@opencode-ai/core/session/goal"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { GoalTool } from "@opencode-ai/core/tool/goal"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_goal_tool_test")
const approvals: PermissionV2.AssertInput[] = []
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => approvals.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, SessionGoal.node, ToolRegistry.node, ToolRegistry.toolsNode, GoalTool.node]),
    [[PermissionV2.node, permission], [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig]],
  ),
)

const setup = Effect.gen(function* () {
  approvals.length = 0
  const { db } = yield* Database.Service
  yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).run().pipe(Effect.orDie)
  yield* db.insert(SessionTable).values({
    id: sessionID,
    project_id: Project.ID.global,
    slug: "goal",
    directory: "/project",
    title: "goal",
    version: "test",
  }).run().pipe(Effect.orDie)
})

const call = (input: { action: string; objective?: string; evidence?: string }, id = "call-goal") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: GoalTool.name, input },
})

describe("GoalTool", () => {
  it.effect("starts, reads, and completes a durable goal through the tool registry", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const goals = yield* SessionGoal.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([GoalTool.name])
      expect(yield* executeTool(registry, call({ action: "start", objective: "Ship Aladdin" }))).toMatchObject({
        type: "text",
      })
      expect(yield* goals.get(sessionID)).toEqual({ objective: "Ship Aladdin", status: "active", evidence: null })
      expect(yield* executeTool(registry, call({ action: "get" }, "call-get"))).toMatchObject({ type: "text" })
      expect(yield* executeTool(registry, call({ action: "complete", evidence: "Verified test" }, "call-done"))).toMatchObject({ type: "text" })
      expect(yield* goals.get(sessionID)).toMatchObject({ status: "completed", evidence: "Verified test" })
      expect(approvals.map((item) => item.action)).toEqual(["goal", "goal"])
    }),
  )
})
