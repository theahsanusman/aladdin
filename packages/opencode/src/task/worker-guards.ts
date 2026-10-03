import { Effect, FileSystem, Layer, Stream } from "effect"
import { LLM, LLMClient, LLMResponse } from "@opencode-ai/llm"
import type { LLMClientShape } from "@opencode-ai/llm"
import type { Interface } from "../session/llm"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { SessionID } from "@opencode-ai/schema/session-id"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { node, Service } from "../session/llm"
import { TaskWorkerPolicy } from "@opencode-ai/core/task/worker-policy"
import { HttpClient } from "effect/unstable/http"

/** Install before building SessionRunner / SessionPrompt, not by providing a
 * replacement around services that have already captured an unguarded client. */
export function v2(
  client: LLMClientShape,
  tasks: TaskExecution.Interface,
  filesystem?: FileSystem.FileSystem,
): LLMClientShape {
  tasks.installGuard("v2")
  const stream: LLMClientShape["stream"] = (request) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const identity = request.http?.headers?.["X-Session-Id"]
        const policy = identity ? yield* tasks.beforeCall(SessionID.make(identity), "v2").pipe(Effect.orDie) : undefined
        if (policy && identity)
          yield* tasks
            .assertModel(SessionID.make(identity), { id: request.model.id, providerID: request.model.provider })
            .pipe(Effect.orDie)
        const input = policy
          ? LLM.updateRequest(request, {
              tools: request.tools.filter((tool) =>
                TaskWorkerPolicy.names(
                  policy,
                  request.tools.map((item) => item.name),
                ).includes(tool.name),
              ),
              ...(policy.mode === "report" && policy.agent !== "michael" ? { toolChoice: "none" } : {}),
            })
          : request
        return client.stream(input).pipe(
          Stream.mapEffect((event) =>
            policy && event.type === "tool-call"
              ? Effect.gen(function* () {
                  if (event.providerExecuted || !filesystem || !identity)
                    return yield* Effect.die(
                      new TaskExecution.Error({ message: "Worker tool boundary is unavailable or provider-hosted" }),
                    )
                  const context = yield* tasks.workerContext(SessionID.make(identity)).pipe(Effect.orDie)
                  if (!context) return yield* Effect.die("Worker ownership disappeared")
                  yield* tasks.beforeTool(SessionID.make(identity)).pipe(Effect.orDie)
                  if (["websearch", "webfetch"].includes(event.name))
                    yield* tasks.beforeNetwork(SessionID.make(identity)).pipe(Effect.orDie)
                  yield* TaskWorkerPolicy.assert(policy, context.directory, event.name, event.input).pipe(
                    Effect.provideService(FileSystem.FileSystem, filesystem),
                    Effect.orDie,
                  )
                  return event
                })
              : Effect.succeed(event),
          ),
        )
      }),
    )
  return {
    ...client,
    stream,
    generate: (request) =>
      Effect.suspend(() => {
        const identity = request.http?.headers?.["X-Session-Id"]
        if (!identity) return client.generate(request)
        return tasks.isWorker(SessionID.make(identity)).pipe(
          Effect.orDie,
          Effect.flatMap((worker) =>
            worker
              ? stream(request).pipe(
                  Stream.runFold(LLMResponse.empty, LLMResponse.reduce),
                  Effect.flatMap((state) => {
                    const response = LLMResponse.complete(state)
                    return response
                      ? Effect.succeed(response)
                      : Effect.die(
                          new TaskExecution.Error({ message: "Provider stream ended without a terminal response" }),
                        )
                  }),
                )
              : client.generate(request),
          ),
        )
      }),
  }
}

export function v1(client: Interface, tasks: TaskExecution.Interface, filesystem?: FileSystem.FileSystem): Interface {
  tasks.installGuard("v1")
  return {
    stream: (request) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const policy = yield* tasks.beforeCall(SessionID.make(request.sessionID), "v1")
          if (policy)
            yield* tasks
              .assertModel(SessionID.make(request.sessionID), {
                id: request.model.id,
                providerID: request.model.providerID,
              })
              .pipe(Effect.orDie)
          return client
            .stream(
              policy
                ? {
                    ...request,
                    tools: Object.fromEntries(
                      Object.entries(request.tools)
                        .filter(([name]) => TaskWorkerPolicy.names(policy, Object.keys(request.tools)).includes(name))
                        .map(([name, tool]) => [
                          name,
                          {
                            ...tool,
                            execute: tool.execute
                              ? async (input, options) => {
                                  if (!filesystem)
                                    throw new TaskExecution.Error({ message: "Worker filesystem guard unavailable" })
                                  const context = await Effect.runPromise(
                                    tasks.workerContext(SessionID.make(request.sessionID)),
                                  )
                                  if (!context)
                                    throw new TaskExecution.Error({ message: "Worker ownership disappeared" })
                                  await Effect.runPromise(tasks.beforeTool(SessionID.make(request.sessionID)))
                                  if (["websearch", "webfetch"].includes(name))
                                    await Effect.runPromise(tasks.beforeNetwork(SessionID.make(request.sessionID)))
                                  await Effect.runPromise(
                                    TaskWorkerPolicy.assert(policy, context.directory, name, input).pipe(
                                      Effect.provideService(FileSystem.FileSystem, filesystem),
                                    ),
                                  )
                                  if (!tool.execute)
                                    throw new TaskExecution.Error({ message: "Native executor unavailable" })
                                  return tool.execute(input, options)
                                }
                              : undefined,
                          },
                        ]),
                    ),
                    ...(policy.mode === "report" && policy.agent !== "michael" ? { toolChoice: "none" as const } : {}),
                    retries: 0,
                    permission: request.permission,
                  }
                : request,
            )
            .pipe(
              Stream.mapEffect((event) =>
                policy && event.type === "tool-call"
                  ? Effect.gen(function* () {
                      if (event.providerExecuted || !filesystem)
                        return yield* Effect.die(
                          new TaskExecution.Error({
                            message: "Worker tool boundary is unavailable or provider-hosted",
                          }),
                        )
                      const context = yield* tasks.workerContext(SessionID.make(request.sessionID)).pipe(Effect.orDie)
                      if (!context) return yield* Effect.die("Worker ownership disappeared")
                      yield* TaskWorkerPolicy.assert(policy, context.directory, event.name, event.input).pipe(
                        Effect.provideService(FileSystem.FileSystem, filesystem),
                        Effect.orDie,
                      )
                      return event
                    })
                  : Effect.succeed(event),
              ),
            )
        }),
      ),
  }
}

// Different node identities prevent a replacement from recursively replacing
// its own raw dependency. Provider services are still built with normal shared
// node/memo-map dependencies; this does not create an ad hoc runtime or DB.
const rawV1 = { ...node, name: "task/raw-v1-llm" }
export const v1Node = LayerNode.make({
  service: Service,
  deps: [rawV1, TaskExecution.node, LayerNodePlatform.filesystem],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const client = yield* Service
      const tasks = yield* TaskExecution.Service
      return v1(client, tasks, yield* FileSystem.FileSystem)
    }),
  ),
})

const rawV2 = { ...LayerNodePlatform.llmClient, name: "task/raw-v2-llm" }
export const v2Node = makeGlobalNode({
  service: LLMClient.Service,
  deps: [rawV2, TaskExecution.node, LayerNodePlatform.filesystem],
  layer: Layer.effect(
    LLMClient.Service,
    Effect.gen(function* () {
      const client = yield* LLMClient.Service
      const tasks = yield* TaskExecution.Service
      return v2(client, tasks, yield* FileSystem.FileSystem)
    }),
  ),
})

const rawHttp = { ...LayerNodePlatform.httpClient, name: "task/raw-http-client" }
export const httpNode = makeGlobalNode({
  service: HttpClient.HttpClient,
  deps: [rawHttp, TaskExecution.node],
  layer: Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const tasks = yield* TaskExecution.Service
      tasks.installNetworkGuard()
      return HttpClient.transform(client, (response, request) => {
        const identity = request.headers["x-session-id"] ?? request.headers["X-Session-Id"]
        return identity
          ? tasks.beforeNetwork(SessionID.make(identity)).pipe(Effect.orDie, Effect.andThen(response))
          : response
      })
    }),
  ),
})

export * as TaskWorkerGuards from "./worker-guards"
