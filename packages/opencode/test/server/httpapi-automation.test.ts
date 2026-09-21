import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Config, Layer } from "effect"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Automation } from "@opencode-ai/schema/automation"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Session } from "@/session/session"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Database.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname + url.search),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function post(path: string, headers: Record<string, string>, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function patch(path: string, headers: Record<string, string>, body: unknown) {
  return request(path, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("automation HttpApi", () => {
  it.instance("creates, lists, updates, and deletes automations", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory }

      const create = yield* post("/automation", headers, {
        name: "Nightly",
        prompt: "Summarize the repo",
        schedule: "daily at 08:00",
        verification: ["echo ok"],
        budgetPerRunTokens: 1000,
        timeoutMinutes: 15,
      })
      expect(create.status).toBe(200)
      const created = yield* json<Automation.Info>(create)
      expect(created.id.startsWith("atm_")).toBe(true)
      expect(created).toMatchObject({
        name: "Nightly",
        prompt: "Summarize the repo",
        kind: "standalone",
        profile: "workspace-write",
        status: "active",
        schedule: { type: "daily", time: "08:00" },
        verification: [{ command: "echo ok" }],
        budgetPerRunTokens: 1000,
        timeoutMinutes: 15,
        directory: test.directory,
      })
      expect(created.nextRunAt).toBeGreaterThan(0)

      const list = yield* json<{ automations: Automation.Info[]; runs: Automation.Run[] }>(
        yield* request("/automation", { headers }),
      )
      expect(list.automations.map((item) => item.id)).toEqual([created.id])
      expect(list.runs).toEqual([])

      const runs = yield* json<Automation.Run[]>(yield* request(`/automation/${created.id}/runs`, { headers }))
      expect(runs).toEqual([])

      const update = yield* patch(`/automation/${created.id}`, headers, {
        prompt: "Summarize the repo differently",
        schedule: "every 30 minutes",
        status: "paused",
      })
      expect(update.status).toBe(200)
      const updated = yield* json<Automation.Info>(update)
      expect(updated).toMatchObject({
        prompt: "Summarize the repo differently",
        schedule: { type: "interval", minutes: 30 },
        status: "paused",
      })

      const resume = yield* patch(`/automation/${created.id}`, headers, { status: "active" })
      const resumed = yield* json<Automation.Info>(resume)
      expect(resumed.status).toBe("active")
      expect(resumed.nextRunAt).toBeGreaterThan(0)

      const read = yield* request("/automation/runs/read", { method: "POST", headers })
      expect(read.status).toBe(200)
      expect(yield* json<boolean>(read)).toBe(true)

      const remove = yield* request(`/automation/${created.id}`, { method: "DELETE", headers })
      expect(remove.status).toBe(200)
      expect(yield* json<boolean>(remove)).toBe(true)

      const gone = yield* json<{ automations: Automation.Info[] }>(yield* request("/automation", { headers }))
      expect(gone.automations).toEqual([])
    }),
  )

  it.instance("rejects invalid schedules and thread automations without a target", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory }

      const badSchedule = yield* post("/automation", headers, { prompt: "Do it", schedule: "now and then" })
      expect(badSchedule.status).toBe(400)
      expect(yield* badSchedule.text).toContain("Invalid schedule: now and then")

      const thread = yield* post("/automation", headers, { prompt: "Do it", schedule: "hourly", kind: "thread" })
      expect(thread.status).toBe(400)
      expect(yield* thread.text).toContain("targetSessionID is required for thread automations")
    }),
  )

  it.instance("scopes automations to the request directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory }
      const otherDirectory = yield* tmpdirScoped({ git: true })
      const otherHeaders = { "x-opencode-directory": otherDirectory }

      const created = yield* json<Automation.Info>(
        yield* post("/automation", headers, { prompt: "Mine", schedule: "hourly" }),
      )

      const otherList = yield* json<{ automations: Automation.Info[] }>(yield* request("/automation", { headers: otherHeaders }))
      expect(otherList.automations).toEqual([])

      const otherRuns = yield* request(`/automation/${created.id}/runs`, { headers: otherHeaders })
      expect(otherRuns.status).toBe(404)
      expect(yield* otherRuns.text).toContain(`Automation not found: ${created.id}`)

      const otherDelete = yield* request(`/automation/${created.id}`, { method: "DELETE", headers: otherHeaders })
      expect(otherDelete.status).toBe(404)

      const stillThere = yield* json<{ automations: Automation.Info[] }>(yield* request("/automation", { headers }))
      expect(stillThere.automations.map((item) => item.id)).toEqual([created.id])
    }),
  )

  it.instance("starts a manual run and reports it in the run list", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-opencode-directory": test.directory }

      const created = yield* json<Automation.Info>(
        yield* post("/automation", headers, { prompt: "Run now", schedule: "hourly" }),
      )

      const started = yield* post(`/automation/${created.id}/run`, headers, {})
      expect(started.status).toBe(200)
      const run = yield* json<Automation.Run>(started)
      expect(run).toMatchObject({
        automationID: created.id,
        status: "queued",
        trigger: "manual",
        unread: false,
      })

      const runs = yield* json<Automation.Run[]>(yield* request(`/automation/${created.id}/runs`, { headers }))
      expect(runs.map((item) => item.id)).toEqual([run.id])

      const read = yield* request("/automation/runs/read", { method: "POST", headers })
      expect(yield* json<boolean>(read)).toBe(true)
    }),
  )
})
