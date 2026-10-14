import { beforeEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Npm } from "@opencode-ai/core/npm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

import { Account } from "../../src/account/account"
import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { AccountRepo } from "../../src/account/repo"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { Config } from "@/config/config"
import { SessionShareTable } from "@opencode-ai/core/share/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { NpmTest } from "../fake/npm"

const env = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node]))
const it = testEffect(env)

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const none = HttpClient.make(() => Effect.die("unexpected http call"))

function requestLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(LayerNode.group([ShareNext.node, AccountRepo.node]), [replacement, [Npm.node, NpmTest.noop]])
}

function integrationLayer(
  client: HttpClient.HttpClient,
  overrides: { config?: Layer.Layer<Config.Service>; account?: Layer.Layer<Account.Service> } = {},
) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(
    LayerNode.group([
      ShareNext.node,
      SessionShare.node,
      EventV2Bridge.node,
      Session.node,
      SessionProjector.node,
      AccountRepo.node,
      Database.node,
      Config.node,
    ]),
    [
      replacement,
      [Npm.node, NpmTest.noop],
      ...(overrides.config ? [[Config.node, overrides.config] as const] : []),
      ...(overrides.account ? [[Account.node, overrides.account] as const] : []),
    ],
  )
}

const share = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareTable)
      .where(eq(SessionShareTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const seed = (url: string, org?: string) =>
  AccountRepo.Service.use((repo) =>
    repo.persistAccount({
      id: AccountID.make("account-1"),
      email: "user@example.com",
      url,
      accessToken: AccessToken.make("st_test_token"),
      refreshToken: RefreshToken.make("rt_test_token"),
      expiry: Date.now() + 10 * 60_000,
      orgID: org ? Option.some(OrgID.make(org)) : Option.none(),
    }),
  )

const savedShare = {
  id: "shr_saved",
  url: "https://legacy-share.example.com/share/saved",
  secret: "sec_saved",
}

const persistShare = Effect.fn("Test.persistShare")(function* (sessionID: SessionID) {
  const database = yield* Database.Service
  const session = yield* Session.Service
  yield* database.db
    .insert(SessionShareTable)
    .values({ session_id: sessionID, ...savedShare })
    .run()
    .pipe(Effect.orDie)
  yield* session.setShare({ sessionID, share: { url: savedShare.url } })
  return yield* share(sessionID)
})

function capture(seen: HttpClientRequest.HttpClientRequest[]) {
  return HttpClient.make((req) => {
    seen.push(req)
    return Effect.succeed(json(req, savedShare))
  })
}

beforeEach(async () => {
  await resetDatabase()
})

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        ShareNext.Service.use((svc) =>
          Effect.gen(function* () {
            const req = yield* svc.request()

            expect(req.api.create).toBe("/api/share")
            expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
            expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
            expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
            expect(req.baseUrl).toBe("https://legacy-share.example.com")
            expect(req.headers).toEqual({})
          }),
        ).pipe(Effect.provide(requestLayer(none))),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      ShareNext.Service.use((svc) =>
        Effect.gen(function* () {
          const req = yield* svc.request()

          expect(req.baseUrl).toBe("https://opncd.ai")
          expect(req.api.create).toBe("/api/share")
          expect(req.headers).toEqual({})
        }),
      ).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.use.request()

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () => {
        const createRequests: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/api/share")) {
            createRequests.push(req)
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })

          const result = yield* (yield* ShareNext.Service).create(session.id)

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = yield* share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(createRequests).toHaveLength(1)
          expect(createRequests[0].method).toBe("POST")
          expect(createRequests[0].url).toBe("https://legacy-share.example.com/api/share")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          seen.push(req)
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service

          yield* service.create(session.id)
          yield* service.remove(session.id)

          expect(yield* share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["POST", "https://legacy-share.example.com/api/share"],
            ["DELETE", "https://legacy-share.example.com/api/share/shr_abc"],
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id)))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* share(session.id)).toBeUndefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  )

  it.live("saved disabled config blocks direct share creation without changing local sessions", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        return Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* ShareNext.Service
          const fresh = yield* session.create({ title: "synthetic fresh session" })
          const existing = yield* session.create({ title: "synthetic saved session" })
          const saved = yield* persistShare(existing.id)
          const before = yield* session.get(existing.id)

          const freshExit = yield* Effect.exit(service.create(fresh.id))
          const existingExit = yield* Effect.exit(service.create(existing.id))

          expect(Exit.isFailure(freshExit)).toBe(true)
          expect(Exit.isFailure(existingExit)).toBe(true)
          expect(seen.map((req) => [req.method, req.url])).toEqual([])
          expect(yield* share(fresh.id)).toBeUndefined()
          expect(yield* share(existing.id)).toEqual(saved)
          expect(yield* session.get(fresh.id)).toEqual(fresh)
          expect(yield* session.get(existing.id)).toEqual(before)
        }).pipe(Effect.provide(integrationLayer(capture(seen))))
      },
      { config: { share: "disabled", enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("saved disabled config suppresses existing-share event uploads and preserves local history", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        return Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* ShareNext.Service
          const events = yield* EventV2Bridge.Service
          const config = yield* Config.Service
          expect((yield* config.get()).share).toBe("disabled")
          const info = yield* session.create({ title: "synthetic private session" })
          const saved = yield* persistShare(info.id)
          const message = yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: info.id,
            role: "assistant",
            parentID: MessageID.ascending(),
            time: { created: 1 },
            modelID: ModelV2.ID.make("test"),
            providerID: ProviderV2.ID.make("test"),
            mode: "",
            agent: "test",
            path: { cwd: info.directory, root: info.directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          })

          yield* service.init()
          yield* session.setTitle({ sessionID: info.id, title: "synthetic local update" })
          yield* session.updateMessage(message)
          yield* session.updatePart({
            id: PartID.ascending(),
            sessionID: info.id,
            messageID: message.id,
            type: "text",
            text: "synthetic local-only transcript",
          })
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [{ file: "synthetic.ts", patch: "synthetic private diff", additions: 1, deletions: 0 }],
          })
          const before = yield* session.get(info.id)
          const history = yield* session.messages({ sessionID: info.id })
          yield* TestClock.adjust(1000)

          expect(seen.map((req) => [req.method, req.url])).toEqual([])
          expect(yield* share(info.id)).toEqual(saved)
          expect(yield* session.get(info.id)).toEqual(before)
          expect(yield* session.messages({ sessionID: info.id })).toEqual(history)
          expect(history[0].parts[0]).toMatchObject({ type: "text", text: "synthetic local-only transcript" })
        }).pipe(Effect.provide(integrationLayer(capture(seen))), Effect.provide(TestClock.layer()))
      },
      { config: { share: "disabled", enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("queued sync is discarded after disable and manual sharing can resume with fresh events", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      return Effect.gen(function* () {
        const policy = yield* Ref.make<"manual" | "disabled">("manual")
        const config = Layer.mock(Config.Service)({
          get: () =>
            Ref.get(policy).pipe(
              Effect.map((share) => ({ share, enterprise: { url: "https://legacy-share.example.com" } })),
            ),
        })
        yield* Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* ShareNext.Service
          const events = yield* EventV2Bridge.Service
          const info = yield* session.create({ title: "synthetic queued session" })
          const saved = yield* persistShare(info.id)
          yield* service.init()
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [{ file: "private.ts", patch: "queued before disable", additions: 1, deletions: 0 }],
          })
          yield* Ref.set(policy, "disabled")
          yield* TestClock.adjust(1000)

          expect(seen.map((req) => [req.method, req.url])).toEqual([])
          expect(yield* share(info.id)).toEqual(saved)

          yield* Ref.set(policy, "manual")
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [{ file: "public.ts", patch: "fresh after manual enable", additions: 2, deletions: 0 }],
          })
          yield* TestClock.adjust(1000)

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_saved/sync")
          expect(seen[0].body._tag).toBe("Uint8Array")
          if (seen[0].body._tag !== "Uint8Array") throw new Error("expected JSON upload")
          expect(JSON.parse(new TextDecoder().decode(seen[0].body.body))).toEqual({
            secret: "sec_saved",
            data: [
              {
                type: "session_diff",
                data: [{ file: "public.ts", patch: "fresh after manual enable", additions: 2, deletions: 0 }],
              },
            ],
          })
        }).pipe(Effect.provide(integrationLayer(capture(seen), { config })))
      }).pipe(Effect.provide(TestClock.layer()))
    }),
  )

  it.live("creation rechecks sharing policy after asynchronous request preparation", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      return Effect.gen(function* () {
        const policy = yield* Ref.make<"manual" | "disabled">("manual")
        const started = yield* Deferred.make<void>()
        const proceed = yield* Deferred.make<void>()
        const config = Layer.mock(Config.Service)({
          get: () =>
            Ref.get(policy).pipe(
              Effect.map((share) => ({ share, enterprise: { url: "https://legacy-share.example.com" } })),
            ),
        })
        const account = Layer.mock(Account.Service)({
          active: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(proceed)),
              Effect.as(Option.none()),
            ),
        })
        yield* Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* ShareNext.Service
          const info = yield* session.create({ title: "synthetic in-flight creation" })
          const creating = yield* service.create(info.id).pipe(Effect.exit, Effect.forkChild)
          yield* Deferred.await(started)
          yield* Ref.set(policy, "disabled")
          yield* Deferred.succeed(proceed, undefined)
          const exit = yield* Fiber.join(creating)

          expect(Exit.isFailure(exit)).toBe(true)
          expect(seen.map((req) => [req.method, req.url])).toEqual([])
          expect(yield* share(info.id)).toBeUndefined()
          expect(yield* session.get(info.id)).toEqual(info)
        }).pipe(Effect.provide(integrationLayer(capture(seen), { config, account })))
      })
    }),
  )

  it.live("queued flush rechecks disabled policy at the outbound request boundary", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      return Effect.gen(function* () {
        const policy = yield* Ref.make<"manual" | "disabled">("manual")
        const config = Layer.mock(Config.Service)({
          get: () =>
            Ref.get(policy).pipe(
              Effect.map((share) => ({ share, enterprise: { url: "https://legacy-share.example.com" } })),
            ),
        })
        const account = Layer.mock(Account.Service)({
          active: () => Ref.set(policy, "disabled").pipe(Effect.as(Option.none())),
        })
        yield* Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* ShareNext.Service
          const events = yield* EventV2Bridge.Service
          const info = yield* session.create({ title: "synthetic preparing flush" })
          const saved = yield* persistShare(info.id)
          yield* service.init()
          yield* events.publish(Session.Event.Diff, { sessionID: info.id, diff: [] })
          yield* TestClock.adjust(1000)

          expect(yield* Ref.get(policy)).toBe("disabled")
          expect(seen.map((req) => [req.method, req.url])).toEqual([])
          expect(yield* share(info.id)).toEqual(saved)
        }).pipe(Effect.provide(integrationLayer(capture(seen), { config, account })))
      }).pipe(Effect.provide(TestClock.layer()))
    }),
  )

  it.live("disabling sharing does not automatically revoke historical shares on delete events", () =>
    provideTmpdirInstance(() => {
      const seen: HttpClientRequest.HttpClientRequest[] = []
      return Effect.gen(function* () {
        const policy = yield* Ref.make<"manual" | "disabled">("manual")
        const config = Layer.mock(Config.Service)({
          get: () =>
            Ref.get(policy).pipe(
              Effect.map((share) => ({ share, enterprise: { url: "https://legacy-share.example.com" } })),
            ),
        })
        yield* Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* ShareNext.Service
          const events = yield* EventV2Bridge.Service
          const info = yield* session.create({ title: "synthetic deletion event" })
          yield* persistShare(info.id)
          yield* service.init()
          // Warm the existing-share cache and queue a sync without sending it yet.
          yield* events.publish(Session.Event.Diff, { sessionID: info.id, diff: [] })
          yield* Ref.set(policy, "disabled")
          yield* events.publish(Session.Event.Deleted, { sessionID: info.id, info })
          yield* TestClock.adjust(1000)

          expect(seen.map((req) => [req.method, req.url])).toEqual([])
        }).pipe(Effect.provide(integrationLayer(capture(seen), { config })))
      }).pipe(Effect.provide(TestClock.layer()))
    }),
  )

  it.live("disabled config still permits explicit unshare without deleting local sessions or history", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        return Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* SessionShare.Service
          const info = yield* session.create({ title: "synthetic explicit unshare" })
          yield* persistShare(info.id)
          const history = yield* session.messages({ sessionID: info.id })
          yield* service.unshare(info.id)

          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["DELETE", "https://legacy-share.example.com/api/share/shr_saved"],
          ])
          expect(yield* share(info.id)).toBeUndefined()
          expect((yield* session.get(info.id)).title).toBe(info.title)
          expect(yield* session.messages({ sessionID: info.id })).toEqual(history)
        }).pipe(Effect.provide(integrationLayer(capture(seen))))
      },
      { config: { share: "disabled", enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  for (const value of ["true", "1"]) {
    it.live(`env-disabled sharing (${value}) blocks uploads but preserves explicit removal`, () =>
      provideTmpdirInstance(
        () => {
          const seen: HttpClientRequest.HttpClientRequest[] = []
          return Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                const previous = process.env.OPENCODE_DISABLE_SHARE
                process.env.OPENCODE_DISABLE_SHARE = value
                return previous
              }),
              (previous) =>
                Effect.sync(() => {
                  if (previous === undefined) delete process.env.OPENCODE_DISABLE_SHARE
                  else process.env.OPENCODE_DISABLE_SHARE = previous
                }),
            )
            const session = yield* Session.Service
            const service = yield* ShareNext.Service
            const events = yield* EventV2Bridge.Service
            const info = yield* session.create({ title: "synthetic env-disabled session" })
            const saved = yield* persistShare(info.id)
            yield* service.init()
            const exit = yield* Effect.exit(service.create(info.id))
            yield* events.publish(Session.Event.Diff, { sessionID: info.id, diff: [] })
            yield* TestClock.adjust(1000)

            expect(Exit.isFailure(exit)).toBe(true)
            expect(seen.map((req) => [req.method, req.url])).toEqual([])
            expect(yield* share(info.id)).toEqual(saved)
            yield* service.remove(info.id)
            expect(seen.map((req) => [req.method, req.url])).toEqual([
              ["DELETE", "https://legacy-share.example.com/api/share/shr_saved"],
            ])
            expect(yield* share(info.id)).toBeUndefined()
            expect((yield* session.get(info.id)).title).toBe(info.title)
          }).pipe(Effect.provide(integrationLayer(capture(seen))), Effect.provide(TestClock.layer()))
        },
        { config: { share: "manual", enterprise: { url: "https://legacy-share.example.com" } } },
      ),
    )
  }

  it.live("manual sharing still creates and uploads a session through the public sharing service", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        return Effect.gen(function* () {
          const session = yield* Session.Service
          const service = yield* SessionShare.Service
          const info = yield* session.create({ title: "synthetic manual share" })
          expect((yield* service.share(info.id)).url).toBe(savedShare.url)
          yield* TestClock.adjust(1000)

          expect(seen.map((req) => req.method)).toEqual(["POST", "POST"])
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share")
          expect(seen[1].url).toBe("https://legacy-share.example.com/api/share/shr_saved/sync")
          expect((yield* session.get(info.id)).share).toEqual({ url: savedShare.url })
          expect((yield* share(info.id))?.id).toBe("shr_saved")
          if (seen[1].body._tag !== "Uint8Array") throw new Error("expected JSON upload")
          const body = JSON.parse(new TextDecoder().decode(seen[1].body.body))
          expect(body.secret).toBe("sec_saved")
          expect(body.data.map((item: { type: string }) => item.type).sort()).toEqual([
            "model",
            "session",
            "session_diff",
          ])
        }).pipe(Effect.provide(integrationLayer(capture(seen))), Effect.provide(TestClock.layer()))
      },
      { config: { share: "manual", enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("ShareNext coalesces rapid diff events into one delayed sync with latest data", () =>
    provideTmpdirInstance(
      () => {
        const seen: Array<{ url: string; body: string }> = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push({ url: req.url, body: new TextDecoder().decode(req.body.body) })
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_abc",
              url: "https://legacy-share.example.com/share/abc",
              secret: "sec_123",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                patch:
                  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+two\n\\ No newline at end of file\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* events.publish(Session.Event.Diff, {
            sessionID: info.id,
            diff: [
              {
                file: "b.ts",
                patch:
                  "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
                additions: 2,
                deletions: 0,
                status: "modified",
              },
            ],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for share sync",
            "5 seconds",
          )

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_abc/sync")

          const body = JSON.parse(seen[0].body) as {
            secret: string
            data: Array<{
              type: string
              data: Array<{
                file: string
                patch: string
                additions: number
                deletions: number
                status?: string
              }>
            }>
          }
          expect(body.secret).toBe("sec_123")
          expect(body.data).toHaveLength(1)
          expect(body.data[0].type).toBe("session_diff")
          expect(body.data[0].data).toEqual([
            {
              file: "b.ts",
              patch:
                "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
              additions: 2,
              deletions: 0,
              status: "modified",
            },
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})
