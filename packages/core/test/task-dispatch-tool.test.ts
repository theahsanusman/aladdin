import { expect } from "bun:test"
import { Effect, Layer, DateTime, Schema } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Database } from "../src/database/database"
import { TaskDispatchTool } from "../src/task/dispatch-tool"
import { TaskExecution } from "../src/task/execution"
import { TaskLedger } from "../src/task/ledger"
import { ToolRegistry } from "../src/tool/registry"
import { Location } from "../src/location"
import { PermissionV2 } from "../src/permission"
import { AgentV2 } from "../src/agent"
import { ProjectTable } from "../src/project/sql"
import { SessionTable, SessionMessageTable } from "../src/session/sql"
import { SessionID } from "@opencode-ai/schema/session-id"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([TaskDispatchTool.node, TaskExecution.node, TaskLedger.node, Database.node, ToolRegistry.node]),
    [
      [PermissionV2.node, Layer.mock(PermissionV2.Service, { assert: () => Effect.void })],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/tool") })],
    ],
  ),
)
it.live("canonical dispatch tool derives root ownership and returns without waiting for a worker", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const ledger = yield* TaskLedger.Service
    const tools = yield* ToolRegistry.Service
    const owner = SessionID.make("ses_dispatch_tool")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: ProjectID.make("tool"), worktree: AbsolutePath.make("/tool"), sandboxes: [] })
    yield* database.db.insert(SessionTable).values({
      id: owner,
      project_id: ProjectID.make("tool"),
      directory: "/tool",
      slug: "root",
      title: "Root",
      version: "test",
    })
    const materialized = yield* tools.materialize()
    const assistantMessageID = SessionMessage.ID.create()
    const message = Schema.encodeSync(SessionMessage.Assistant)(
      SessionMessage.Assistant.make({
        id: assistantMessageID,
        type: "assistant",
        agent: "michael-lead",
        model: {
          id: Model.ID.make("lead-model"),
          providerID: Provider.ID.make("lead-provider"),
          variant: Model.VariantID.make("max"),
        },
        content: [],
        time: { created: DateTime.makeUnsafe(Date.now()) },
      }),
    )
    yield* database.db.insert(SessionMessageTable).values({
      id: assistantMessageID,
      session_id: owner,
      type: "assistant",
      seq: 1,
      data: message,
    } satisfies typeof SessionMessageTable.$inferInsert)
    const result = yield* materialized.settle({
      sessionID: owner,
      agent: AgentV2.ID.make("michael-lead"),
      assistantMessageID,
      call: {
        type: "tool-call",
        id: "dispatch",
        name: "task_dispatch",
        input: {
          dispatchKey: "one",
          brief: {
            title: "Report",
            objective: "Explain facts",
            scope: ["Facts"],
            output: "Report",
            checks: ["Nonempty"],
            constraints: [],
            execution: {
              engine: "v2",
              mode: "report",
              agent: "build",
              model: { id: "model", providerID: "provider" },
              maxCalls: 1,
              wallClockMs: 1000,
            },
          },
        },
      },
    })
    expect(yield* ledger.list(owner)).toHaveLength(1)
    expect((yield* ledger.list(owner))[0]?.status).toBe("queued")
    expect((yield* ledger.list(owner))[0]?.brief.execution?.agent).toBe("michael")
    expect((yield* ledger.list(owner))[0]?.brief.execution?.model).toEqual({
      id: "lead-model",
      providerID: "lead-provider",
      variant: "max",
    })
    expect(result.result.type).not.toBe("error")
  }),
)
