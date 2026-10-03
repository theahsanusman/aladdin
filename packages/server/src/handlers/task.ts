import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskInteractionStore } from "@opencode-ai/core/task/interaction"
import { SessionStore } from "@opencode-ai/core/session/store"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, UnknownError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"

const domain = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) => {
      if (error instanceof InvalidRequestError) return error
      if (error instanceof TaskLedger.Error) {
        if (error.code === "conflict" || error.code === "stale_attempt" || error.code === "invalid_transition")
          return new ConflictError({ message: error.message })
        return new InvalidRequestError({ message: error.message })
      }
      if (error instanceof TaskExecution.Error) return new ServiceUnavailableError({ message: error.message })
      if (error instanceof TaskInteractionStore.Error) return new ConflictError({ message: error.message })
      return new UnknownError({ message: "Task operation failed; inspect server diagnostics" })
    }),
  )

export const TaskHandler = HttpApiBuilder.group(Api, "server.task", (handlers) =>
  Effect.gen(function* () {
    const ledger = yield* TaskLedger.Service
    const execution = yield* TaskExecution.Service
    const interactions = yield* TaskInteractionStore.Service
    const sessions = yield* SessionStore.Service
    return handlers
      .handle("task.board", (ctx) => domain(ledger.board(ctx.params.sessionID)))
      .handle("task.list", (ctx) =>
        domain(
          Effect.gen(function* () {
            const tasks = yield* ledger.list(ctx.params.sessionID, ctx.query.after ?? 0)
            const data = yield* Effect.forEach(tasks, (task) =>
              ledger.details({ ownerSessionID: ctx.params.sessionID, taskID: task.id }),
            )
            return { data, team: yield* ledger.team(ctx.params.sessionID) }
          }),
        ),
      )
      .handle("task.get", (ctx) =>
        domain(
          ledger
            .details({ ownerSessionID: ctx.params.sessionID, taskID: ctx.params.taskID })
            .pipe(Effect.map((data) => ({ data }))),
        ),
      )
      .handle("task.dispatch", (ctx) =>
        domain(
          Effect.gen(function* () {
            const configured = ctx.payload.brief.execution
            if (!configured)
              return yield* new InvalidRequestError({
                message: "Task dispatch requires an immutable execution configuration",
              })
            const owner = yield* sessions.get(ctx.params.sessionID)
            if ((owner?.agent === "michael-lead" || owner?.agent === "dispatcher") && !owner.model)
              return yield* new InvalidRequestError({
                message: "Select a model and send a lead message before dispatching a worker",
              })
            const snapshot =
              owner?.model && (owner.agent === "michael-lead" || owner.agent === "dispatcher")
                ? {
                    ...configured,
                    agent: "michael",
                    model: { ...owner.model, variant: owner.model.variant ?? "default" },
                  }
                : configured
            yield* execution.prepare(ctx.params.sessionID, configured.engine)
            const policy = yield* execution.capture(ctx.params.sessionID, snapshot)
            return {
              data: yield* execution.dispatch({
                ownerSessionID: ctx.params.sessionID,
                ...ctx.payload,
                brief: { ...ctx.payload.brief, execution: policy },
              }),
            }
          }),
        ),
      )
      .handle("task.cancel", (ctx) =>
        domain(
          execution
            .cancel({ ownerSessionID: ctx.params.sessionID, taskID: ctx.params.taskID })
            .pipe(Effect.map((data) => ({ data }))),
        ),
      )
      .handle("task.retry", (ctx) =>
        domain(
          Effect.gen(function* () {
            const owner = yield* sessions.get(ctx.params.sessionID)
            const task = yield* ledger.get({ ownerSessionID: ctx.params.sessionID, taskID: ctx.params.taskID })
            if (
              (owner?.agent === "michael-lead" || owner?.agent === "dispatcher") &&
              task.brief.execution?.agent !== "michael"
            )
              return yield* new InvalidRequestError({
                message:
                  "This older task uses a different agent. Create a new task from Michael Lead to use Michael and the lead's current model.",
              })
            return {
              data: yield* execution.retry({
                ownerSessionID: ctx.params.sessionID,
                taskID: ctx.params.taskID,
                ...ctx.payload,
              }),
            }
          }),
        ),
      )
      .handle("task.dismiss", (ctx) =>
        domain(
          ledger
            .dismiss({ ownerSessionID: ctx.params.sessionID, taskID: ctx.params.taskID })
            .pipe(Effect.map((data) => ({ data }))),
        ),
      )
      .handle("task.pause", (ctx) =>
        domain(
          execution.pause(ctx.params.sessionID).pipe(
            Effect.andThen(ledger.team(ctx.params.sessionID)),
            Effect.map((data) => ({ data })),
          ),
        ),
      )
      .handle("task.resume", (ctx) =>
        domain(
          execution.resume(ctx.params.sessionID).pipe(
            Effect.andThen(ledger.team(ctx.params.sessionID)),
            Effect.map((data) => ({ data })),
          ),
        ),
      )
      .handle("task.events", (ctx) =>
        domain(
          ledger.team(ctx.params.sessionID).pipe(
            Effect.andThen(ledger.events({ ownerSessionID: ctx.params.sessionID, after: ctx.query.after ?? 0 })),
            Effect.map((data) => ({ data })),
          ),
        ),
      )
      .handle("task.interactions", (ctx) =>
        domain(
          ledger.team(ctx.params.sessionID).pipe(
            Effect.andThen(interactions.pending(ctx.params.sessionID)),
            Effect.map((data) => ({ data })),
          ),
        ),
      )
      .handle("task.answer", (ctx) =>
        domain(
          Effect.gen(function* () {
            const owned = { ownerSessionID: ctx.params.sessionID, id: ctx.params.interactionID }
            const request = yield* interactions.get(owned)
            if (request.generation !== ctx.payload.generation)
              return yield* new ConflictError({ message: "Answer refers to an older worker generation" })
            yield* execution.deliver(request, ctx.payload.decision)
            return { data: yield* interactions.get(owned) }
          }),
        ),
      )
  }),
)
