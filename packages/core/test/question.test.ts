import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"
import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { SessionTable } from "../src/session/sql"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskLedger } from "../src/task/ledger"
import { TaskInteractionStore } from "../src/task/interaction"

const questions = AppNodeBuilder.build(
  LayerNode.group([Database.node, EventV2.node, QuestionV2.node, TaskLedger.node, TaskInteractionStore.node]),
)
const it = testEffect(questions)

const sessionID = SessionV2.ID.make("ses_question_test")
const question: QuestionV2.Info = {
  question: "Which option?",
  header: "Option",
  options: [{ label: "One", description: "First option" }],
}

const waitForAsk = Effect.fn("QuestionV2Test.waitForAsk")(function* (
  service: QuestionV2.Interface,
  input: QuestionV2.AskInput,
) {
  const events = yield* EventV2.Service
  const asked = yield* Deferred.make<QuestionV2.Request>()
  const unsubscribe = yield* events.listen((event) =>
    event.type === QuestionV2.Event.Asked.type
      ? Deferred.succeed(asked, event.data as QuestionV2.Request).pipe(Effect.asVoid)
      : Effect.void,
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  const fiber = yield* service.ask(input).pipe(Effect.forkScoped)
  return { fiber, request: yield* Deferred.await(asked) }
})

describe("QuestionV2", () => {
  it.live("persists a worker's exact native request and answer before resolving its wait", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const ledger = yield* TaskLedger.Service
      const interactions = yield* TaskInteractionStore.Service
      const service = yield* QuestionV2.Service
      yield* db.insert(ProjectTable).values({
        id: ProjectID.make("question-worker"),
        worktree: AbsolutePath.make("/question-worker"),
        sandboxes: [],
      })
      yield* db.insert(SessionTable).values({
        id: sessionID,
        project_id: ProjectID.make("question-worker"),
        directory: "/question-worker",
        slug: "question-worker",
        title: "Question worker",
        version: "test",
      })
      yield* ledger.admit({
        ownerSessionID: sessionID,
        dispatchKey: "question-worker",
        brief: {
          title: "Worker",
          objective: "Ask for a decision",
          scope: ["This project"],
          output: "Report",
          checks: ["Decision recorded"],
          constraints: [],
        },
      })
      const attempt = yield* ledger.claim({ ownerSessionID: sessionID, runtimeEpoch: "question-test" })
      if (!attempt) return yield* Effect.die("Expected worker claim")
      yield* ledger.transition(attempt, "running")
      const pending = yield* waitForAsk(service, { sessionID: attempt.workerSessionID, questions: [question] })
      const saved = (yield* interactions.list({ ownerSessionID: sessionID }))[0]
      expect(saved).toMatchObject({
        requestID: pending.request.id,
        workerSessionID: attempt.workerSessionID,
        state: "pending",
      })
      yield* service.reply({ requestID: pending.request.id, answers: [["One"]] })
      expect(yield* Fiber.join(pending.fiber)).toEqual([["One"]])
      expect((yield* interactions.list({ ownerSessionID: sessionID }))[0]).toMatchObject({
        state: "decided",
        decision: { kind: "question", answers: [["One"]] },
      })
      const next = yield* waitForAsk(service, { sessionID: attempt.workerSessionID, questions: [question] })
      yield* ledger.interruptEpoch("question-test")
      expect(yield* Effect.flip(service.reply({ requestID: next.request.id, answers: [["One"]] }))).toMatchObject({
        _tag: "QuestionV2.NotFoundError",
      })
      expect(
        (yield* interactions.list({ ownerSessionID: sessionID })).filter((item) => item.state === "pending"),
      ).toHaveLength(1)
      yield* Fiber.interrupt(next.fiber)
    }),
  )
  it.effect("publishes lifecycle events and settles a pending reply", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const events = yield* EventV2.Service
      const published: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type.startsWith("question.v2.")) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const { fiber, request } = yield* waitForAsk(service, { sessionID, questions: [question] })

      expect(request.id).toMatch(/^que_/)
      expect(yield* service.list()).toEqual([request])
      yield* service.reply({ requestID: request.id, answers: [["One"]] })

      expect(yield* Fiber.join(fiber)).toEqual([["One"]])
      expect(yield* service.list()).toEqual([])
      expect(published.map((event) => [event.type, event.data])).toEqual([
        [QuestionV2.Event.Asked.type, request],
        [QuestionV2.Event.Replied.type, { sessionID, requestID: request.id, answers: [["One"]] }],
      ])
    }),
  )

  it.effect("publishes rejection, fails the ask, and rejects unknown IDs", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const events = yield* EventV2.Service
      const published: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === QuestionV2.Event.Rejected.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const { fiber, request } = yield* waitForAsk(service, { sessionID, questions: [question] })

      yield* service.reject(request.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("QuestionV2.RejectedError")
      expect(published.map((event) => event.data)).toEqual([{ sessionID, requestID: request.id }])

      const unknown = QuestionV2.ID.ascending("que_unknown")
      expect(yield* service.reply({ requestID: unknown, answers: [] }).pipe(Effect.flip)).toEqual(
        new QuestionV2.NotFoundError({ requestID: unknown }),
      )
      expect(yield* service.reject(unknown).pipe(Effect.flip)).toEqual(
        new QuestionV2.NotFoundError({ requestID: unknown }),
      )
    }),
  )

  it.effect("isolates pending requests by location-layer instance and rejects them on finalization", () =>
    Effect.gen(function* () {
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      const first = Context.get(yield* Layer.buildWithScope(Layer.fresh(questions), firstScope), QuestionV2.Service)
      const second = Context.get(yield* Layer.buildWithScope(Layer.fresh(questions), secondScope), QuestionV2.Service)
      const fiber = yield* first.ask({ sessionID, questions: [question] }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      const request = (yield* first.list())[0]!

      expect(yield* second.list()).toEqual([])
      expect(yield* second.reply({ requestID: request.id, answers: [["One"]] }).pipe(Effect.flip)).toEqual(
        new QuestionV2.NotFoundError({ requestID: request.id }),
      )

      yield* Scope.close(firstScope, Exit.void)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("QuestionV2.RejectedError")
      yield* Scope.close(secondScope, Exit.void)
    }),
  )
})
