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
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
// Providers resolve local $defs references themselves, so follow them here too
// and assert on the shape a model actually receives.
const resolve = (value: unknown, defs: Record<string, unknown>): Record<string, unknown> | undefined => {
  const schema = record(value)
  const ref = schema?.$ref
  return typeof ref === "string" && ref.startsWith("#/$defs/") ? record(defs[ref.slice("#/$defs/".length)]) : schema
}

it.live("canonical dispatch advertises one structured brief object and refuses a serialized one", () =>
  Effect.gen(function* () {
    const tools = yield* ToolRegistry.Service
    const materialized = yield* tools.materialize()
    const definition = materialized.definitions.find((item) => item.name === TaskDispatchTool.name)
    // The root must stay an object schema: providers reject a tool input that is
    // only a `$ref`, even when the definition it points at is an object.
    expect(definition?.inputSchema.type).toBe("object")
    expect(definition?.inputSchema.$ref).toBeUndefined()
    const defs = record(definition?.inputSchema.$defs) ?? {}
    const brief = resolve(record(resolve(definition?.inputSchema, defs)?.properties)?.brief, defs)
    expect(brief?.type).toBe("object")
    expect(brief?.anyOf).toBeUndefined()
    expect(brief?.required).toEqual(
      expect.arrayContaining(["title", "objective", "scope", "output", "checks", "constraints", "execution"]),
    )
    const result = yield* materialized.settle({
      sessionID: SessionID.make("ses_dispatch_serialized"),
      agent: AgentV2.ID.make("michael-lead"),
      assistantMessageID: SessionMessage.ID.create(),
      call: {
        type: "tool-call",
        id: "dispatch",
        name: TaskDispatchTool.name,
        input: {
          dispatchKey: "serialized",
          brief: JSON.stringify({
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
          }),
        },
      },
    })
    expect(result.result.type).toBe("error")
  }),
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
