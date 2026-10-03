import { expect } from "bun:test"
import { Effect, FileSystem, Layer, Schema, Stream } from "effect"
import { LLMClient, LLMEvent, Model } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols/openai-chat"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { SessionID } from "@opencode-ai/schema/session-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskWorkerGuards } from "../src/task/worker-guards"
import { TaskWorkerPermissionGuards } from "../src/task/permission-guards"
import { TaskWorkerBootstrap } from "../src/task/bootstrap"
import { tmpdirScoped } from "./fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "./lib/effect"
import { installTaskInteractionSchema } from "./lib/task-schema"

const guarded = makeGlobalNode({
  service: LLMClient.Service,
  deps: [TaskExecution.node, LayerNodePlatform.filesystem],
  layer: Layer.effect(
    LLMClient.Service,
    Effect.gen(function* () {
      const tasks = yield* TaskExecution.Service
      const fs = yield* FileSystem.FileSystem
      return TaskWorkerGuards.v2(
        {
          prepare: () => Effect.die("Unused"),
          generate: () => Effect.die("Unused"),
          stream: (request) =>
            Stream.fromIterable<LLMEvent>(
              request.messages.some((message) => message.role === "tool")
                ? [
                    LLMEvent.stepStart({ index: 0 }),
                    LLMEvent.textStart({ id: "text" }),
                    LLMEvent.textDelta({ id: "text", text: "Patch ready" }),
                    LLMEvent.textEnd({ id: "text" }),
                    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
                    LLMEvent.finish({ reason: "stop" }),
                  ]
                : [
                    LLMEvent.stepStart({ index: 0 }),
                    LLMEvent.toolCall({
                      id: "write",
                      name: "write",
                      input: { path: "new.txt", content: "V2 coding\n" },
                    }),
                    LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
                    LLMEvent.finish({ reason: "tool-calls" }),
                  ],
            ),
        },
        tasks,
        fs,
      )
    }),
  ),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionExecutionLocal.node,
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      TaskExecution.node,
      TaskLedger.node,
      LocationServiceMap.node,
      CrossSpawnSpawner.node,
    ]),
    [
    [LayerNodePlatform.llmClient, guarded],
    [LayerNodePlatform.httpClient, TaskWorkerGuards.httpNode],
      [PermissionV2.node, TaskWorkerPermissionGuards.v2Node],
      [
        SessionRunnerModel.node,
        SessionRunnerModel.layerWith(() =>
          Effect.succeed(Model.make({ id: "model", provider: "test", route: OpenAIChat.route })),
        ),
      ],
    ],
  ),
)

it.live(
  "V2 coding routes by the isolated worker Location and integrates native write evidence",
  () =>
  Effect.gen(function* () {
    yield* installTaskInteractionSchema
    const root = yield* tmpdirScoped({ git: true })
      const storage = yield* tmpdirScoped()
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const locations = yield* LocationServiceMap.Service
      const tasks = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const owner = SessionID.make("ses_v2_coding_root")
      yield* database.db
        .insert(ProjectTable)
        .values({ id: ProjectID.make("v2_coding"), worktree: AbsolutePath.make(root), sandboxes: [] })
      yield* database.db
        .insert(SessionTable)
        .values({
          id: owner,
          project_id: ProjectID.make("v2_coding"),
          directory: root,
          slug: "root",
          title: "Root",
          version: "test",
        })
      yield* events.listen((event) =>
        event.type !== PermissionV2.Event.Asked.type
          ? Effect.void
          : Effect.gen(function* () {
              const request = Schema.decodeUnknownSync(PermissionV2.Request)(event.data)
              const worker = yield* tasks.workerContext(request.sessionID)
              if (!worker) return yield* Effect.die("No worker permission owner")
              yield* PermissionV2.Service.use((permission) =>
                permission.reply({ requestID: request.id, reply: "once" }),
              ).pipe(Effect.provide(locations.get({ directory: worker.directory })))
            }).pipe(Effect.orDie),
      )
      yield* Effect.gen(function* () {
        const agents = yield* AgentV2.Service
        yield* agents.transform((draft) =>
          draft.update(AgentV2.ID.make("build"), (agent) => {
            agent.steps = 4
            agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
          }),
        )
        yield* TaskWorkerBootstrap.v2({
          directory: AbsolutePath.make(root),
          storage,
          verify: () => Effect.succeed([]),
          codingChecks: (workspace) =>
            Effect.tryPromise(() => Bun.file(`${workspace.directory}/new.txt`).text()).pipe(
              Effect.map((content) => [
                {
                  check: "File",
                  passed: content === "V2 coding\n",
                  evidence: "Host inspected actual canonical write in isolated Location",
                },
              ]),
            ),
        })
      }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(root) })))
      const baseRevision = yield* Effect.tryPromise(async () => {
        const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe" })
        const text = await new Response(child.stdout).text()
        if (await child.exited) throw new Error("Missing base")
        return text.trim()
      })
      const task = yield* tasks.dispatch({
        ownerSessionID: owner,
        dispatchKey: "coding",
        brief: {
          title: "Coding",
          objective: "Write file",
          scope: ["new.txt"],
          output: "Patch",
          checks: ["File"],
          constraints: [],
          execution: {
            engine: "v2",
            mode: "coding",
            paths: ["new.txt"],
            baseRevision,
            agent: "build",
            model: { id: "model", providerID: "test" },
            maxCalls: 3,
            wallClockMs: 20000,
          },
        },
      })
      yield* tasks.idle(owner)
      const history = yield* ledger.events({ ownerSessionID: owner, after: 0 })
      expect(
        (yield* ledger.get({ ownerSessionID: owner, taskID: task.id })).status,
        history.findLast((event) => event.kind === "settled")?.evidence ?? (yield* tasks.error(owner)),
      ).toBe("completed")
      expect(yield* Effect.tryPromise(() => Bun.file(`${root}/new.txt`).text())).toBe("V2 coding\n")
    }),
  30000,
)
