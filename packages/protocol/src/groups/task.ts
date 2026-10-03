import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Task } from "@opencode-ai/schema/task"
import { TaskInteraction } from "@opencode-ai/schema/task-interaction"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnknownError,
} from "../errors"

const params = { sessionID: SessionID }
const item = { ...params, taskID: Task.ID }
const errors = [InvalidRequestError, SessionNotFoundError, ConflictError, ServiceUnavailableError, UnknownError]
const page = Schema.Struct({ after: Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt), Schema.optional) })

export const makeTaskGroup = <I extends HttpApiMiddleware.AnyId, S>(middleware: Context.Key<I, S>) =>
  HttpApiGroup.make("server.task")
    .add(
      HttpApiEndpoint.get("task.board", "/api/session/:sessionID/task-board", {
        params,
        success: Task.Board,
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.board",
          summary: "Read assigned workers, queued work and recent persistent results",
        }),
      ),
      HttpApiEndpoint.get("task.list", "/api/session/:sessionID/task", {
        params,
        query: page,
        success: Schema.Struct({ data: Schema.Array(Task.Details), team: Task.Team }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.task.list", summary: "List this chat's durable worker tasks" }),
      ),
      HttpApiEndpoint.get("task.get", "/api/session/:sessionID/task/:taskID", {
        params: item,
        success: Schema.Struct({ data: Task.Details }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.task.get", summary: "Read one owned task and its persistent result" }),
      ),
      HttpApiEndpoint.post("task.dispatch", "/api/session/:sessionID/task", {
        params,
        payload: Schema.Struct({ dispatchKey: Task.Dispatch.fields.dispatchKey, brief: Task.Brief }),
        success: Schema.Struct({ data: Task.Info }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.dispatch",
          summary: "Admit detached work to this chat's worker queue",
        }),
      ),
      HttpApiEndpoint.post("task.cancel", "/api/session/:sessionID/task/:taskID/cancel", {
        params: item,
        success: Schema.Struct({ data: Task.Info }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.task.cancel", summary: "Cancel one task and join its owned cleanup" }),
      ),
      HttpApiEndpoint.post("task.retry", "/api/session/:sessionID/task/:taskID/retry", {
        params: item,
        payload: Schema.Struct({
          generation: Task.Generation,
          confirmStopped: Schema.optional(Schema.Boolean),
          reviewedChanges: Schema.optional(Schema.Boolean),
        }),
        success: Schema.Struct({ data: Task.Info }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.retry",
          summary: "Explicitly retry a safely settled or reconciled worker failure",
        }),
      ),
      HttpApiEndpoint.post("task.pause", "/api/session/:sessionID/task/pause", {
        params,
        success: Schema.Struct({ data: Task.Team }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.task.pause", summary: "Durably pause this chat's queued dispatch" }),
      ),
      HttpApiEndpoint.post("task.resume", "/api/session/:sessionID/task/resume", {
        params,
        success: Schema.Struct({ data: Task.Team }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.task.resume", summary: "Resume this chat's queued dispatch" }),
      ),
      HttpApiEndpoint.get("task.events", "/api/session/:sessionID/task-events", {
        params,
        query: page,
        success: Schema.Struct({ data: Schema.Array(Task.Event) }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.events",
          summary: "Replay committed task transitions after a cursor",
        }),
      ),
      HttpApiEndpoint.get("task.interactions", "/api/session/:sessionID/task-interactions", {
        params,
        success: Schema.Struct({ data: Schema.Array(TaskInteraction.Info) }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.interactions",
          summary: "Read this chat's worker questions and permission decisions",
        }),
      ),
      HttpApiEndpoint.post("task.answer", "/api/session/:sessionID/task-interactions/:interactionID", {
        params: { ...params, interactionID: TaskInteraction.ID },
        payload: Schema.Struct({ generation: Task.Generation, decision: TaskInteraction.Decision }),
        success: Schema.Struct({ data: TaskInteraction.Info }),
        error: errors,
      }).annotateMerge(
        OpenApi.annotations({ identifier: "v2.task.answer", summary: "Deliver an exact owned native worker decision" }),
      ),
    )
    .middleware(middleware)
