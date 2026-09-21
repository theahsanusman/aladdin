import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { QuestionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { Unattended } from "@/automation/unattended"
import { QuestionV1 } from "@opencode-ai/schema/question-v1"

export const Option = QuestionV1.Option
export type Option = typeof Option.Type
export const Info = QuestionV1.Info
export type Info = typeof Info.Type
export const Prompt = QuestionV1.Prompt
export type Prompt = typeof Prompt.Type
export const Tool = QuestionV1.Tool
export type Tool = typeof Tool.Type
export const Request = QuestionV1.Request
export type Request = typeof Request.Type
export const Answer = QuestionV1.Answer
export type Answer = typeof Answer.Type
export const Reply = QuestionV1.Reply
export type Reply = typeof Reply.Type
export const Replied = QuestionV1.Replied
export const Rejected = QuestionV1.Rejected
export const Event = QuestionV1.Event

/** How a question was settled: an explicit answer, the deadline, an explicit skip, or unattended resolution. */
export type Resolution = "user" | "timeout" | "skipped" | "unattended"

export interface Result {
  readonly answers: ReadonlyArray<Answer>
  readonly source: Resolution
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Question.NotFoundError", {
  requestID: QuestionID,
}) {}

export class ExpiredError extends Schema.TaggedErrorClass<ExpiredError>()("Question.ExpiredError", {
  requestID: QuestionID,
}) {
  override get message() {
    return "This question already ended before an answer arrived"
  }
}

/** Default wait window when neither the tool nor config sets one. */
export const DEFAULT_TIMEOUT_SECONDS = 300

/** Bounded tombstone memory so late replies can be told apart from unknown requests. */
const MAX_EXPIRED = 100

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<Result, RejectedError>
}

interface State {
  pending: Map<QuestionID, PendingEntry>
  expired: Map<QuestionID, number>
}

// Service

export interface Interface {
  readonly ask: (input: {
    sessionID: SessionID
    questions: ReadonlyArray<Info>
    tool?: Tool
    timeoutSeconds?: number
  }) => Effect.Effect<Result, RejectedError>
  readonly reply: (input: {
    requestID: QuestionID
    answers: ReadonlyArray<Answer>
  }) => Effect.Effect<void, NotFoundError | ExpiredError>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void, NotFoundError | ExpiredError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Question") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Question.state")(function* () {
        const state: State = {
          pending: new Map<QuestionID, PendingEntry>(),
          expired: new Map<QuestionID, number>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
            state.expired.clear()
          }),
        )

        return state
      }),
    )

    /** Settles one pending request: publishes the matching event, then resolves the waiting ask. */
    const settle = Effect.fn("Question.settle")(function* (
      id: QuestionID,
      source: Resolution,
      answers: ReadonlyArray<Answer>,
    ) {
      const current = yield* InstanceState.get(state)
      const existing = current.pending.get(id)
      if (!existing) return
      current.pending.delete(id)
      yield* Effect.logInfo("resolved", { requestID: id, source })

      if (source === "skipped") {
        yield* events.publish(Event.Rejected, { sessionID: existing.info.sessionID, requestID: id })
      } else {
        yield* events.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: id,
          answers: answers.map((answer) => [...answer]),
          source,
        })
      }

      // Non-user resolutions leave a tombstone so a late reply can tell the user
      // their answer arrived after the turn already moved on.
      current.expired.set(id, Date.now())
      for (const key of current.expired.keys()) {
        if (current.expired.size <= MAX_EXPIRED) break
        current.expired.delete(key)
      }

      yield* Deferred.succeed(existing.deferred, { answers, source })
    })

    const assume = (questions: ReadonlyArray<Info>) =>
      questions.map((question) => (question.options[0] ? [question.options[0].label] : []))

    const ask = Effect.fn("Question.ask")(function* (input: {
      sessionID: SessionID
      questions: ReadonlyArray<Info>
      tool?: Tool
      timeoutSeconds?: number
    }) {
      const cfg = yield* config.get()
      const { pending } = yield* InstanceState.get(state)
      const configured = cfg.question?.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS
      const requested = input.timeoutSeconds ?? configured
      const seconds = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0
      const onTimeout = cfg.question?.on_timeout ?? "assume"

      // Unattended sessions have nobody to answer, so the deadline is now and the
      // result is reported as unattended instead of pretending it timed out.
      const unattended = Unattended.isUnattended(input.sessionID)
      const deadlineMs = unattended ? 0 : seconds * 1000
      const source: Resolution = unattended ? "unattended" : onTimeout === "skip" ? "skipped" : "timeout"
      const id = QuestionID.ascending()
      yield* Effect.logInfo("asking", { id, questions: input.questions.length, timeoutSeconds: seconds, unattended })

      const deferred = yield* Deferred.make<Result, RejectedError>()
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
        timeoutSeconds: seconds,
        expiresAt: Date.now() + deadlineMs,
      }
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)

      const fallback =
        source === "skipped"
          ? settle(id, "skipped", [])
          : source === "unattended"
            ? settle(id, "unattended", assume(input.questions))
            : settle(id, "timeout", assume(input.questions))

      return yield* Effect.ensuring(
        deadlineMs <= 0
          ? fallback.pipe(Effect.andThen(Deferred.await(deferred)))
          : Effect.raceFirst(
              Deferred.await(deferred),
              Effect.sleep(deadlineMs).pipe(Effect.andThen(fallback), Effect.andThen(Deferred.await(deferred))),
            ),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Question.reply")(function* (input: {
      requestID: QuestionID
      answers: ReadonlyArray<Answer>
    }) {
      const current = yield* InstanceState.get(state)
      const existing = current.pending.get(input.requestID)
      if (!existing) {
        if (current.expired.has(input.requestID)) {
          yield* Effect.logWarning("reply after expiry", { requestID: input.requestID })
          return yield* new ExpiredError({ requestID: input.requestID })
        }
        yield* Effect.logWarning("reply for unknown request", { requestID: input.requestID })
        return yield* new NotFoundError({ requestID: input.requestID })
      }
      current.pending.delete(input.requestID)
      yield* Effect.logInfo("replied", { requestID: input.requestID, answers: input.answers })
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        answers: input.answers.map((a) => [...a]),
        source: "user",
      })
      yield* Deferred.succeed(existing.deferred, { answers: input.answers, source: "user" } satisfies Result)
    })

    // An explicit skip is not a failure: the turn continues and the model is told
    // to use its own judgment instead of treating the user as having rejected it.
    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const current = yield* InstanceState.get(state)
      if (!current.pending.has(requestID)) {
        if (current.expired.has(requestID)) {
          yield* Effect.logWarning("skip after expiry", { requestID })
          return yield* new ExpiredError({ requestID })
        }
        yield* Effect.logWarning("skip for unknown request", { requestID })
        return yield* new NotFoundError({ requestID })
      }
      yield* settle(requestID, "skipped", [])
    })

    const list = Effect.fn("Question.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Config.node] })

export * as Question from "."
