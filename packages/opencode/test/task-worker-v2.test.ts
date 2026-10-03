import { afterAll, expect } from "bun:test"
import { Deferred, Effect, FileSystem, Layer, Schema, Stream } from "effect"
import { LLM, LLMClient, LLMEvent, Model } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols/openai-chat"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { node } from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Location } from "@opencode-ai/core/location"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { SystemContext } from "@opencode-ai/core/system-context"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { SessionID } from "@opencode-ai/schema/session-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskWorkerV2 } from "../src/task/worker-v2"
import { TaskWorkerGuards } from "../src/task/worker-guards"
import { testEffect } from "./lib/effect"
import { ReadTool } from "@opencode-ai/core/tool/read"
import { QuestionTool } from "@opencode-ai/core/tool/question"
import { QuestionV2 } from "@opencode-ai/core/question"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { tmpdir } from "./fixture/fixture"
import { TaskWorkerPermissionGuards } from "../src/task/permission-guards"
import { installTaskInteractionSchema } from "./lib/task-schema"

const temporary = await tmpdir()
afterAll(() => temporary[Symbol.asyncDispose]())
const directory = AbsolutePath.make(temporary.path)
const guarded = makeGlobalNode({
  service: LLMClient.Service,
  deps: [TaskExecution.node, LayerNodePlatform.filesystem],
  layer: Layer.effect(
    LLMClient.Service,
    Effect.gen(function* () {
      const tasks = yield* TaskExecution.Service
      const filesystem = yield* FileSystem.FileSystem
      return TaskWorkerGuards.v2(
        {
          prepare: () => Effect.die("Unused"),
          generate: () => Effect.die("Unused"),
          stream: (request) =>
            Stream.unwrap(
              Effect.gen(function* () {
                const id = request.http?.headers?.["X-Session-Id"]
                if (!id) return yield* Effect.die(JSON.stringify(request.http))
                const context = id ? yield* tasks.workerContext(SessionID.make(id)) : undefined
                if (
                  context?.execution.mode === "research" &&
                  !request.messages.some((message) => message.role === "tool")
                ) {
                  const name = context.task.dispatchKey === "question" ? "question" : "read"
                  expect(request.tools.map((tool) => tool.name)).toContain(name)
                  const input =
                    name === "read"
                      ? { path: "facts.txt" }
                      : {
                          questions: [
                            {
                              question: "Choose a direction",
                              header: "Direction",
                              options: [{ label: "A", description: "Direction A" }],
                            },
                          ],
                        }
                  return Stream.fromIterable<LLMEvent>([
                    LLMEvent.stepStart({ index: 0 }),
                    LLMEvent.toolCall({ id: "call", name, input }),
                    LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
                    LLMEvent.finish({ reason: "tool-calls" }),
                  ])
                }
                if (context?.execution.mode !== "research") {
                  expect(request.tools).toEqual([])
                  expect(request.toolChoice).toMatchObject({ type: "none" })
                }
                return Stream.fromIterable<LLMEvent>([
                  LLMEvent.stepStart({ index: 0 }),
                  LLMEvent.textStart({ id: "text" }),
                  LLMEvent.textDelta({ id: "text", text: "Native report" }),
                  LLMEvent.textEnd({ id: "text" }),
                  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
                  LLMEvent.finish({ reason: "stop" }),
                ])
              }).pipe(Effect.orDie),
            ),
        },
        tasks,
        filesystem,
      )
    }),
  ),
})
const base = AppNodeBuilder.build(
  LayerNode.group([
    node,
    Database.node,
    EventV2.node,
    SessionProjector.node,
    SessionStore.node,
    TaskExecution.node,
    TaskLedger.node,
    AgentV2.node,
    SessionRunnerModel.node,
    LayerNodePlatform.llmClient,
    LayerNodePlatform.httpClient,
    ReadTool.node,
    QuestionTool.node,
    QuestionV2.node,
    PermissionV2.node,
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
    [Location.node, Location.boundNode({ directory })],
    [Snapshot.node, Snapshot.noopLayer],
    [Config.node, Layer.mock(Config.Service, { entries: () => Effect.succeed([]) })],
    [SkillGuidance.node, Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })],
    [
      ReferenceGuidance.node,
      Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) }),
    ],
  ],
)
const it = testEffect(
  Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const runner = yield* SessionRunner.Service
      const coordinator = yield* SessionRunCoordinator.make({
        drain: (sessionID: SessionID, force: boolean) => runner.run({ sessionID, force }),
      })
      return {
        active: coordinator.active,
        resume: coordinator.run,
        wake: coordinator.wake,
        interrupt: coordinator.interrupt,
      }
    }),
  ).pipe(Layer.provideMerge(base)),
)

it.live("research runs canonical read and native question/permission waits through existing V2 continuation", () =>
  Effect.gen(function* () {
    yield* installTaskInteractionSchema
    const database = yield* Database.Service
    const tasks = yield* TaskExecution.Service
    const ledger = yield* TaskLedger.Service
    const agents = yield* AgentV2.Service
    const events = yield* EventV2.Service
    const permissions = yield* PermissionV2.Service
    const questions = yield* QuestionV2.Service
    const asked = yield* Deferred.make<QuestionV2.Request>()
    yield* events.listen((event) =>
      Effect.gen(function* () {
        if (event.type === PermissionV2.Event.Asked.type) {
          const request = Schema.decodeUnknownSync(PermissionV2.Request)(event.data)
          yield* permissions.reply({ requestID: request.id, reply: "once" })
        }
        if (event.type === QuestionV2.Event.Asked.type)
          yield* Deferred.succeed(asked, Schema.decodeUnknownSync(QuestionV2.Request)(event.data))
      }).pipe(Effect.orDie),
    )
    yield* Effect.tryPromise(() => Bun.write(`${directory}/facts.txt`, "Project facts\n"))
    const owner = SessionID.make("ses_research")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: ProjectID.make("research"), worktree: directory, sandboxes: [] })
    yield* database.db
      .insert(SessionTable)
      .values({
        id: owner,
        project_id: ProjectID.make("research"),
        directory,
        slug: "root",
        title: "Root",
        version: "test",
      })
    yield* agents.transform((draft) =>
      draft.update(AgentV2.ID.make("research"), (agent) => {
        agent.steps = 4
        agent.permissions = [{ action: "*", resource: "*", effect: "ask" }]
      }),
    )
    yield* tasks.register(
      yield* TaskWorkerV2.make(directory, () =>
        Effect.succeed([{ check: "Result", passed: true, evidence: "Host observed native completion" }]),
      ),
    )
    const brief = {
      title: "Research",
      objective: "Read facts and ask",
      scope: ["Project"],
      output: "Report",
      checks: ["Result"],
      constraints: [],
      execution: {
        engine: "v2" as const,
        mode: "research" as const,
        agent: "research",
        model: { id: "model", providerID: "test" },
        maxCalls: 3,
        wallClockMs: 10000,
      },
    }
    yield* tasks.dispatch({ ownerSessionID: owner, dispatchKey: "read", brief })
    const question = yield* tasks.dispatch({ ownerSessionID: owner, dispatchKey: "question", brief })
    const request = yield* Deferred.await(asked).pipe(
      Effect.timeoutOrElse({
        duration: 2000,
        orElse: () =>
          Effect.gen(function* () {
            const store = yield* SessionStore.Service
            const events = yield* ledger.events({ ownerSessionID: owner, after: 0 })
            const attempt = events.find((event) => event.attempt?.taskID === question.id)?.attempt
            return yield* Effect.die(JSON.stringify(attempt ? yield* store.context(attempt.workerSessionID) : events))
          }),
      }),
    )
    expect((yield* ledger.worker(request.sessionID))?.taskID).toBe(question.id)
    expect(request.questions[0]?.options[0]?.label).toBe("A")
    yield* questions.reply({ requestID: request.id, answers: [["A"]] })
    yield* tasks.idle(owner)
    expect((yield* ledger.list(owner)).map((task) => task.status)).toEqual(["completed", "completed"])
  }),
)

it.live("V2 worker executes the canonical native runner from one durable predetermined input", () =>
  Effect.gen(function* () {
    yield* installTaskInteractionSchema
    const database = yield* Database.Service
    const tasks = yield* TaskExecution.Service
    const ledger = yield* TaskLedger.Service
    const agents = yield* AgentV2.Service
    const owner = SessionID.make("ses_v2_worker_root")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: ProjectID.make("v2_worker"), worktree: directory, sandboxes: [] })
    yield* database.db.insert(SessionTable).values({
      id: owner,
      project_id: ProjectID.make("v2_worker"),
      directory,
      slug: "root",
      title: "Root",
      version: "test",
    })
    yield* agents.transform((draft) =>
      draft.update(AgentV2.ID.make("worker"), (agent) => {
        agent.steps = 2
      }),
    )
    const driver = yield* TaskWorkerV2.make(directory, (task, output) =>
      Effect.succeed([
        {
          check: "Expected report",
          passed: output === "Native report",
          evidence: "Host compared native durable output",
        },
      ]),
    )
    yield* tasks.register(driver)
    const task = yield* tasks.dispatch({
      ownerSessionID: owner,
      dispatchKey: "one",
      brief: {
        title: "Report",
        objective: "Explain supplied facts",
        scope: ["Facts"],
        output: "Report",
        checks: ["Expected report"],
        constraints: [],
        execution: {
          engine: "v2",
          mode: "report",
          agent: "worker",
          model: { id: "model", providerID: "test" },
          maxCalls: 1,
          wallClockMs: 10_000,
        },
      },
    })
    yield* tasks.idle(owner)
    expect(yield* tasks.error(owner)).toBeUndefined()
    const events = yield* ledger.events({ ownerSessionID: owner, after: 0 })
    expect(
      (yield* ledger.get({ ownerSessionID: owner, taskID: task.id })).status,
      events.findLast((event) => event.kind === "settled")?.evidence,
    ).toBe("completed")
    const attempt = events.find((event) => event.kind === "claimed")?.attempt
    if (!attempt) return yield* Effect.die("Missing claim")
    expect((yield* SessionInput.find(database.db, attempt.inputMessageID))?.promotedSeq).toBeDefined()
    expect(yield* database.db.select().from(SessionTable).all()).toHaveLength(2)
  }),
)

it.live("native generate also uses the guarded stream instead of bypassing task call budgets", () =>
  Effect.gen(function* () {
    yield* installTaskInteractionSchema
    const database = yield* Database.Service
    const tasks = yield* TaskExecution.Service
    const ledger = yield* TaskLedger.Service
    const client = yield* LLMClient.Service
    const owner = SessionID.make("ses_v2_generate_root")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: ProjectID.make("v2_generate"), worktree: directory, sandboxes: [] })
    yield* database.db.insert(SessionTable).values({
      id: owner,
      project_id: ProjectID.make("v2_generate"),
      directory,
      slug: "root",
      title: "Root",
      version: "test",
    })
    yield* tasks.register({
      engine: "v2",
      directory,
      run: (task, attempt) =>
        client
          .generate(
            LLM.request({
              model: Model.make({ id: "model", provider: "test", route: OpenAIChat.route }),
              prompt: "Facts",
              http: { headers: { "X-Session-Id": attempt.workerSessionID } },
            }),
          )
          .pipe(
            Effect.as({
              summary: "Report",
              checks: [{ check: "Nonempty", passed: true, evidence: "Host observed successful generation" }],
            }),
          ),
      cleanup: () => Effect.succeed("Stopped"),
    })
    const task = yield* tasks.dispatch({
      ownerSessionID: owner,
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
          agent: "worker",
          model: { id: "model", providerID: "test" },
          maxCalls: 1,
          wallClockMs: 1000,
        },
      },
    })
    yield* tasks.idle(owner)
    expect((yield* ledger.get({ ownerSessionID: owner, taskID: task.id })).status).toBe("completed")
  }),
)
