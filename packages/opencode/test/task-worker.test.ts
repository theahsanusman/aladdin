import { expect } from "bun:test"
import { Deferred, Effect, FileSystem, Layer, Schema, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Agent } from "../src/agent/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "../src/provider/provider"
import { MessageID } from "../src/session/schema"
import { LLM } from "../src/session/llm"
import { SessionPrompt } from "../src/session/prompt"
import { Session } from "../src/session/session"
import { TaskWorkerV1 } from "../src/task/worker-v1"
import { TaskWorkerGuards } from "../src/task/worker-guards"
import { testProviderConfig } from "./lib/test-provider"
import { testEffect } from "./lib/effect"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Permission } from "../src/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { TaskWorkerPermissionGuards } from "../src/task/permission-guards"
import { TestInstance } from "./fixture/fixture"
import { tmpdirScoped } from "./fixture/fixture"
import { InstanceStore } from "../src/project/instance-store"
import { TaskWorkerBootstrap } from "../src/task/bootstrap"
import { InstanceRef } from "../src/effect/instance-ref"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceBootstrap } from "../src/project/bootstrap-service"
import { TaskCodingServices } from "../src/task/coding-services"
import { Format } from "../src/format"
import { LSP } from "../src/lsp/lsp"
import { installTaskInteractionSchema } from "./lib/task-schema"
import { TaskDispatchV1 } from "../src/task/dispatch-v1"
import { Truncate } from "../src/tool/truncate"
import { TaskHost } from "../src/task/host"
import { Config } from "../src/config/config"
import { Plugin } from "../src/plugin"
import { TaskInteractionStore } from "@opencode-ai/core/task/interaction"
import { Question } from "../src/question"
import { TaskInteraction } from "@opencode-ai/schema/task-interaction"

const guarded = Layer.effect(
  LLM.Service,
  Effect.gen(function* () {
    const tasks = yield* TaskExecution.Service
    const filesystem = yield* FileSystem.FileSystem
    return TaskWorkerGuards.v1(
      {
        stream: (request) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const context = yield* tasks.workerContext(request.user.sessionID)
              if (
                context &&
                context.execution.mode !== "report" &&
                !request.messages.some((message) => message.role === "tool")
              ) {
                const name = context.execution.mode === "coding" ? "write" : "read"
                const tool = request.tools[name]
                if (!tool?.execute) return yield* Effect.die("Native read executor missing")
                const input =
                  context.execution.mode === "coding"
                    ? { filePath: `${context.directory}/new.txt`, content: "Verified coding\n" }
                    : { filePath: `${context.directory}/facts.txt` }
                return Stream.fromIterable<LLMEvent>([
                  LLMEvent.stepStart({ index: 0 }),
                  LLMEvent.toolCall({ id: "call", name, input }),
                ]).pipe(
                  Stream.concat(
                    Stream.unwrap(
                      Effect.tryPromise(async () => {
                        const result = await tool.execute?.(input, { toolCallId: "call", messages: request.messages })
                        if (
                          !result ||
                          typeof result !== "object" ||
                          !("output" in result) ||
                          typeof result.output !== "string" ||
                          (name === "read" && !result.output.includes("Project facts"))
                        )
                          throw new Error("Native tool did not return expected output")
                        return Stream.fromIterable<LLMEvent>([
                          LLMEvent.toolResult({ id: "call", name, result: { type: "text", value: result.output } }),
                          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
                          LLMEvent.finish({ reason: "tool-calls" }),
                        ])
                      }),
                    ),
                  ),
                )
              }
              if (context?.execution.mode === "report" && context.execution.agent !== "michael") {
                expect(request.tools).toEqual({})
                expect(request.toolChoice).toBe("none")
              }
              expect(request.retries).toBe(0)
              return Stream.fromIterable<LLMEvent>([
                LLMEvent.stepStart({ index: 0 }),
                LLMEvent.textStart({ id: "text" }),
                LLMEvent.textDelta({ id: "text", text: "Verified report" }),
                LLMEvent.textEnd({ id: "text" }),
                LLMEvent.stepFinish({ index: 0, reason: "stop" }),
                LLMEvent.finish({ reason: "stop" }),
              ])
            }),
          ),
      },
      tasks,
      filesystem,
    )
  }),
)
const guardedNode = LayerNode.make({
  service: LLM.Service,
  layer: guarded,
  deps: [TaskExecution.node, LayerNodePlatform.filesystem],
})
const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      Session.node,
      SessionProjector.node,
      SessionStore.node,
      TaskExecution.node,
      TaskHost.node,
      TaskLedger.node,
      TaskInteractionStore.node,
      Database.node,
      EventV2.node,
      Agent.node,
      Provider.node,
      Permission.node,
      InstanceStore.node,
      CrossSpawnSpawner.node,
      Truncate.node,
      LayerNodePlatform.httpClient,
    ]),
    [
      [LLM.node, guardedNode],
      [Permission.node, TaskWorkerPermissionGuards.v1Node],
      [InstanceStore.node, TaskWorkerBootstrap.instanceNode],
      [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
      [Format.node, TaskCodingServices.formatNode],
      [LSP.node, TaskCodingServices.lspNode],
      [Config.node, TaskCodingServices.configNode],
      [Provider.node, TaskCodingServices.providerNode],
      [Plugin.node, TaskCodingServices.pluginNode],
      [LayerNodePlatform.httpClient, TaskWorkerGuards.httpNode],
    ],
  ),
)

it.instance(
  "the application host prepares a real detached V1 driver and persists its result",
  () =>
    Effect.gen(function* () {
      yield* installTaskInteractionSchema
      const sessions = yield* Session.Service
      const execution = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const root = yield* sessions.create({ title: "Host root" })
      yield* execution.prepare(root.id, "v1")
      yield* execution.prepare(root.id, "v1")
      const task = yield* execution.dispatch({
        ownerSessionID: root.id,
        dispatchKey: "host-report",
        brief: {
          title: "Report",
          objective: "Explain the supplied facts",
          scope: ["Supplied facts only"],
          output: "A report",
          checks: ["output:nonempty"],
          constraints: ["No mutations"],
          execution: {
            engine: "v1",
            mode: "report",
            agent: "build",
            model: { id: "test-model", providerID: "test" },
            maxCalls: 2,
            wallClockMs: 15_000,
          },
        },
      })
      yield* execution.idle(root.id)
      const saved = yield* ledger.details({ ownerSessionID: root.id, taskID: task.id })
      expect(saved.task.status, saved.evidence).toBe("completed")
      expect(saved.evidence).toContain("Host inspected a nonempty")
      expect(saved.attempt?.workerSessionID).not.toBe(root.id)
    }),
  { config: testProviderConfig("http://127.0.0.1:1") },
)

it.instance(
  "host verification uses an exact native question and holds the slot until the owner answers",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const execution = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const interactions = yield* TaskInteractionStore.Service
      const events = yield* EventV2.Service
      const root = yield* sessions.create({ title: "Verification root" })
      yield* execution.prepare(root.id, "v1")
      const asked = yield* Deferred.make<TaskInteraction.Info>()
      const off = yield* events.listen((event) =>
        event.type === Question.Event.Asked.type
          ? Effect.gen(function* () {
              const pending = (yield* interactions.pending(root.id))[0]
              if (pending) yield* Deferred.succeed(asked, pending)
            }).pipe(Effect.orDie)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => off)
      const task = yield* execution.dispatch({
        ownerSessionID: root.id,
        dispatchKey: "verify",
        brief: {
          title: "Verify",
          objective: "Explain facts",
          scope: ["Facts"],
          output: "Report",
          checks: ["The supplied facts are accurately explained"],
          constraints: [],
          execution: {
            engine: "v1",
            mode: "report",
            agent: "build",
            model: { id: "test-model", providerID: "test" },
            maxCalls: 2,
            wallClockMs: 15_000,
          },
        },
      })
      const request = yield* Deferred.await(asked)
      expect((yield* ledger.get({ ownerSessionID: root.id, taskID: task.id })).status).toBe("waiting_for_user")
      expect(request.taskID).toBe(task.id)
      expect(request.ownerSessionID).toBe(root.id)
      expect(JSON.stringify(request.payload)).toContain("Worker report:")
      yield* execution.deliver(request, { kind: "question", answers: [["Passed"]] })
      yield* execution.idle(root.id)
      const result = yield* ledger.details({ ownerSessionID: root.id, taskID: task.id })
      expect(result.task.status, result.evidence).toBe("completed")
      expect(result.evidence).toContain("Explicit native human verification")
    }),
  { config: testProviderConfig("http://127.0.0.1:1") },
)

it.instance(
  "V1 coding uses its existing native write loop in an isolated worktree and authorizes integration",
  () =>
    Effect.gen(function* () {
      yield* installTaskInteractionSchema
      const test = yield* TestInstance
      const storage = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const tasks = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const events = yield* EventV2.Service
      const permissions = yield* Permission.Service
      const instances = yield* InstanceStore.Service
      yield* events.listen((event) =>
        event.type !== Permission.Event.Asked.type
          ? Effect.void
          : Effect.gen(function* () {
              const request = Schema.decodeUnknownSync(PermissionV1.Request)(event.data)
              if (request.permission === "task_integrate") {
                expect(request.metadata.target).toBe(test.directory)
                expect(yield* Effect.tryPromise(() => Bun.file(`${test.directory}/new.txt`).exists())).toBe(false)
              }
              const worker = yield* sessions.get(request.sessionID)
              const placement = yield* instances.load({ directory: worker.directory })
              yield* permissions
                .reply({ requestID: request.id, reply: "once" })
                .pipe(Effect.provideService(InstanceRef, placement))
            }).pipe(Effect.orDie),
      )
      const root = yield* sessions.create({ title: "Root" })
      yield* TaskWorkerBootstrap.v1({
        storage,
        verify: () => Effect.succeed([]),
        codingChecks: (workspace) =>
          Effect.tryPromise(() => Bun.file(`${workspace.directory}/new.txt`).text()).pipe(
            Effect.map((text) => [
              {
                check: "File",
                passed: text === "Verified coding\n",
                evidence: "Host checked actual native write output in isolated checkout",
              },
            ]),
          ),
      })
      const baseRevision = yield* Effect.tryPromise(async () => {
        const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: test.directory, stdout: "pipe" })
        const text = await new Response(child.stdout).text()
        if (await child.exited) throw new Error("Missing base")
        return text.trim()
      })
      const task = yield* tasks.dispatch({
        ownerSessionID: root.id,
        dispatchKey: "coding",
        brief: {
          title: "Coding",
          objective: "Write new file",
          scope: ["new.txt"],
          output: "Patch",
          checks: ["File"],
          constraints: [],
          execution: {
            engine: "v1",
            mode: "coding",
            paths: ["new.txt"],
            baseRevision,
            agent: "build",
            model: { id: "test-model", providerID: "test" },
            maxCalls: 3,
            wallClockMs: 15000,
          },
        },
      })
      yield* tasks.idle(root.id)
      const history = yield* ledger.events({ ownerSessionID: root.id, after: 0 })
      expect(
        (yield* ledger.get({ ownerSessionID: root.id, taskID: task.id })).status,
        history.findLast((event) => event.kind === "settled")?.evidence ?? (yield* tasks.error(root.id)),
      ).toBe("completed")
      expect(yield* Effect.tryPromise(() => Bun.file(`${test.directory}/new.txt`).text())).toBe("Verified coding\n")
    }),
  {
    git: true,
    config: testProviderConfig("http://127.0.0.1:1"),
    init: (directory) =>
      Effect.tryPromise(async () => {
        await Bun.write(`${directory}/.gitignore`, "opencode.json\n")
        const child = Bun.spawn(["git", "add", ".gitignore"], { cwd: directory })
        if (await child.exited) throw new Error("Cannot stage fixture config")
        const commit = Bun.spawn(["git", "commit", "-m", "fixture"], { cwd: directory })
        if (await commit.exited) throw new Error("Cannot commit fixture config")
      }),
  },
)

it.instance(
  "V1 research executes the native read tool under its owning Instance and permission reply",
  () =>
    Effect.gen(function* () {
      yield* installTaskInteractionSchema
      const test = yield* TestInstance
      yield* Effect.tryPromise(() => Bun.write(`${test.directory}/facts.txt`, "Project facts\n"))
      const sessions = yield* Session.Service
      const tasks = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const events = yield* EventV2.Service
      const permissions = yield* Permission.Service
      yield* events.listen((event) =>
        event.type !== Permission.Event.Asked.type
          ? Effect.void
          : Effect.gen(function* () {
              const request = Schema.decodeUnknownSync(PermissionV1.Request)(event.data)
              yield* permissions.reply({ requestID: request.id, reply: "once" })
            }).pipe(Effect.orDie),
      )
      const root = yield* sessions.create({ title: "Root" })
      yield* tasks.register(
        yield* TaskWorkerV1.make(() =>
          Effect.succeed([
            { check: "Read facts", passed: true, evidence: "Host read tool result contained the actual project facts" },
          ]),
        ),
      )
      const task = yield* tasks.dispatch({
        ownerSessionID: root.id,
        dispatchKey: "research",
        brief: {
          title: "Research",
          objective: "Read project facts",
          scope: ["Project"],
          output: "Report",
          checks: ["Read facts"],
          constraints: [],
          execution: {
            engine: "v1",
            mode: "research",
            agent: "build",
            model: { id: "test-model", providerID: "test" },
            maxCalls: 3,
            wallClockMs: 10000,
          },
        },
      })
      yield* tasks.idle(root.id)
      const eventsAfter = yield* ledger.events({ ownerSessionID: root.id, after: 0 })
      expect(
        (yield* ledger.get({ ownerSessionID: root.id, taskID: task.id })).status,
        eventsAfter.findLast((event) => event.kind === "settled")?.evidence,
      ).toBe("completed")
    }),
  { config: testProviderConfig("http://127.0.0.1:1") },
)

it.instance(
  "V1 dispatch creates a durable native worker/input and persists independently verified results",
  () =>
    Effect.gen(function* () {
      yield* installTaskInteractionSchema
      const sessions = yield* Session.Service
      const tasks = yield* TaskExecution.Service
      const ledger = yield* TaskLedger.Service
      const root = yield* sessions.create({ title: "Root" })
      yield* tasks.register(
        yield* TaskWorkerV1.make((_task, output) =>
          Effect.succeed([
            {
              check: "Expected report",
              passed: output === "Verified report",
              evidence: "Host compared exact expected output",
            },
          ]),
        ),
      )
      const leaf = yield* TaskDispatchV1.Tool
      const definition = yield* leaf.init()
      const lead = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        sessionID: root.id,
        parentID: MessageID.ascending(),
        role: "assistant",
        mode: "michael-lead",
        agent: "michael-lead",
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        path: { cwd: root.directory, root: root.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      const context = {
        sessionID: root.id,
        messageID: lead.id,
        agent: "michael-lead",
        messages: [],
        abort: new AbortController().signal,
        ask: () => Effect.void,
        metadata: () => Effect.void,
      }
      const admission = yield* definition.execute(
        {
          dispatchKey: "leaf",
          brief: {
            title: "Leaf",
            objective: "Explain facts",
            scope: ["Facts"],
            output: "Report",
            checks: ["Expected report"],
            constraints: [],
            execution: {
              engine: "v1",
              mode: "report",
              agent: "build",
              model: { id: "wrong-model", providerID: "wrong-provider", variant: "max" },
              maxCalls: 1,
              wallClockMs: 10000,
            },
          },
        },
        context,
      )
      expect(admission.metadata.status).toBe("queued")
      expect((yield* ledger.list(root.id))[0]?.brief.execution?.model).toEqual({
        id: "test-model",
        providerID: "test",
        variant: "default",
      })
      expect(
        yield* Effect.exit(
          definition.execute(
            {
              dispatchKey: "wrong-engine",
              brief: {
                title: "Wrong",
                objective: "Explain",
                scope: ["Facts"],
                output: "Report",
                checks: ["Expected report"],
                constraints: [],
                execution: {
                  engine: "v2",
                  mode: "report",
                  agent: "build",
                  model: { id: "test-model", providerID: "test" },
                  maxCalls: 1,
                  wallClockMs: 10000,
                },
              },
            },
            context,
          ),
        ),
      ).toMatchObject({ _tag: "Failure" })
      const brief = {
        title: "Report",
        objective: "Explain facts",
        scope: ["Supplied facts"],
        output: "Report",
        checks: ["Expected report"],
        constraints: ["No tools"],
        execution: {
          engine: "v1" as const,
          mode: "report" as const,
          agent: "build",
          model: { id: "test-model", providerID: "test" },
          maxCalls: 1,
          wallClockMs: 20_000,
        },
      }
      const task = yield* tasks.dispatch({ ownerSessionID: root.id, dispatchKey: "one", brief })
      yield* tasks.idle(root.id)
      expect(yield* tasks.error(root.id)).toBeUndefined()
      expect((yield* ledger.get({ ownerSessionID: root.id, taskID: task.id })).status).toBe("completed")
      const events = yield* ledger.events({ ownerSessionID: root.id, after: 0 })
      const claim = events.find((event) => event.kind === "claimed")?.attempt
      if (!claim) return yield* Effect.die("Missing claim")
      const worker = yield* sessions.get(claim.workerSessionID)
      expect(worker.parentID).toBe(root.id)
      expect(worker.directory).toBe(root.directory)
      const messages = yield* sessions.messages({ sessionID: worker.id })
      expect(messages.filter((message) => message.info.role === "user")).toHaveLength(1)
      expect(messages.find((message) => message.info.role === "user")?.info.id).toBe(
        MessageID.make(claim.inputMessageID),
      )
      expect(events.findLast((event) => event.kind === "settled")?.evidence).toContain(
        "Host compared exact expected output",
      )
    }),
  {
    config: {
      ...testProviderConfig("http://127.0.0.1:1"),
      agent: { michael: { mode: "primary", prompt: "Michael worker test" } },
    },
  },
)
