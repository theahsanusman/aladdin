import { afterEach, describe, expect, test } from "bun:test"
import { Deferred, Effect as Fx } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionID } from "@opencode-ai/schema/session-id"
import { eq } from "drizzle-orm"
import { EventV2 } from "@opencode-ai/core/event"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { TaskInteractionStore } from "@opencode-ai/core/task/interaction"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { pollWithTimeout, testEffectShared } from "../lib/effect"

// Shares the process-wide memoMap with Server.Default so the registered driver
// and the HTTP handlers observe the same TaskExecution instance. This file
// stays a single test: sharedRun closes its scope at test end, which shuts the
// shared TaskExecution down for any later test in the same file.
const it = testEffectShared(
  LayerNode.compile(
    LayerNode.group([Database.node, EventV2.node, TaskLedger.node, TaskInteractionStore.node, TaskExecution.node]),
  ),
)

if (process.env.ALADDIN_TASK_HTTPAPI_ISOLATED === "1") {
  afterEach(async () => {
    await disposeAllInstances()
    await resetDatabase()
  })
}

function http(path: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return Fx.promise(() => Promise.resolve(Server.Default().app.request(path, { ...init, headers })))
}

function body<A>(response: Response) {
  return Fx.promise(async () => {
    const value = await response.json()
    if (!response.ok) throw new Error(`Task HTTP ${response.status}: ${JSON.stringify(value)}`)
    return value as A
  })
}

function post(path: string, directory: string, payload: unknown) {
  return http(path, directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function brief(n: number) {
  return {
    title: `Task ${n}`,
    objective: "Report the facts supplied in this brief",
    scope: [`scope-${n}`],
    output: "A short report",
    checks: [`check-${n}`],
    constraints: [],
    execution: {
      engine: "v1" as const,
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      mode: "report" as const,
      maxCalls: 4,
      wallClockMs: 120_000,
    },
  }
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Fx.acquireRelease(
    Fx.promise(() => tmpdir(options)),
    (tmp) => Fx.promise(() => tmp[Symbol.asyncDispose]()),
  )

const countsOf = (sessionID: string, directory: string) =>
  http(`/api/session/${sessionID}/task-board`, directory).pipe(
    Fx.andThen(body<{ counts: Record<string, number>; team: { paused: boolean } }>),
    Fx.map((value) => value.counts),
  )

const createSession = (directory: string) =>
  post("/api/session", directory, { location: { directory } }).pipe(
    Fx.andThen(body<{ data: { id: string } }>),
    Fx.map((value) => value.data.id),
  )

const dispatchTask = (sessionID: string, key: string, n: number, directory: string) =>
  post(`/api/session/${sessionID}/task`, directory, { dispatchKey: key, brief: brief(n) }).pipe(
    Fx.andThen(body<{ data: { id: string } }>),
    Fx.map((value) => value.data.id),
  )

const expectCounts = (sessionID: string, directory: string, expected: Record<string, number>, message: string) =>
  pollWithTimeout(
    countsOf(sessionID, directory).pipe(
      Fx.map((counts) =>
        Object.entries(expected).every(([status, amount]) => (counts[status] ?? 0) === amount) ? true : undefined,
      ),
    ),
    message,
    "10 seconds",
  )

// Other server tests intentionally dispose the process-global execution host.
// Run this integration test in a fresh process, just as a newly started app does,
// instead of registering its workers into an executor that has been shut down.
if (process.env.ALADDIN_TASK_HTTPAPI_ISOLATED !== "1") {
  test("task HttpApi: three-worker teams, pause/cancel, isolation, replay, and interactions", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: process.cwd(),
      env: { ...process.env, ALADDIN_TASK_HTTPAPI_ISOLATED: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code !== 0) throw new Error(`Task HTTP integration subprocess failed (${code}):\n${stdout}\n${stderr}`)
    expect(code).toBe(0)
  }, 60_000)
}
if (process.env.ALADDIN_TASK_HTTPAPI_ISOLATED === "1")
  describe("task HttpApi", () => {
    it.live(
      "three-worker teams, pause/cancel, isolation, replay, and interactions",
      () =>
        Fx.gen(function* () {
          const tmp = yield* tmpdirEffect({ git: true, config: { formatter: false, lsp: false } })
          const directory = tmp.path

          // One held-worker driver for the whole file; every chat shares this
          // directory placement, so a single registration covers all of them.
          const latches = new Map<string, Deferred.Deferred<void>>()
          const execution = yield* TaskExecution.Service
          yield* execution.register({
            engine: "v1",
            directory: AbsolutePath.make(directory),
            run: (task) =>
              Fx.gen(function* () {
                const latch = yield* Deferred.make<void>()
                latches.set(task.id, latch)
                yield* Deferred.await(latch)
                return {
                  summary: `Held worker finished ${task.brief.title}`,
                  checks: task.brief.checks.map((check) => ({
                    check,
                    passed: true,
                    evidence: "Held worker satisfied the acceptance check",
                  })),
                }
              }),
            cleanup: () => Fx.succeed("Fake driver joined native tool cleanup"),
          })

          // Phase A — A1/A3/A6: every chat owns a three-worker team.
          const chats: string[] = []
          for (let index = 0; index < 3; index++) chats.push(yield* createSession(directory))
          const database = yield* Database.Service
          yield* database.db
            .update(SessionTable)
            .set({
              agent: "michael-lead",
              model: { id: "lead-model", providerID: "lead-provider", variant: "max" },
            })
            .where(eq(SessionTable.id, SessionID.make(chats[0])))

          const dispatched = new Map<string, string>()
          for (const [chatIndex, sessionID] of chats.entries()) {
            for (let taskIndex = 0; taskIndex < 5; taskIndex++) {
              const key = `chat-${chatIndex}-task-${taskIndex}`
              dispatched.set(key, yield* dispatchTask(sessionID, key, taskIndex, directory))
            }
          }

          // A1: three running and two queued per chat — nine assigned workers in
          // total, so there is no hidden global-three limit across chats.
          for (const sessionID of chats)
            yield* expectCounts(
              sessionID,
              directory,
              { running: 3, queued: 2 },
              "a chat never reached three running and two queued tasks",
            )
          const totalRunning = yield* Fx.forEach(chats, (sessionID) => countsOf(sessionID, directory)).pipe(
            Fx.map((all) => all.reduce((sum, counts) => sum + (counts.running ?? 0), 0)),
          )
          expect(totalRunning).toBe(9)

          // A3: an exact retry returns the same task, a conflicting brief is rejected.
          const expectedFirst = dispatched.get("chat-0-task-0") ?? ""
          expect(expectedFirst).not.toBe("")
          const retry = yield* dispatchTask(chats[0], "chat-0-task-0", 0, directory)
          expect(retry).toBe(expectedFirst)
          const conflict = yield* post(`/api/session/${chats[0]}/task`, directory, {
            dispatchKey: "chat-0-task-0",
            brief: brief(42),
          })
          expect(conflict.status).toBeGreaterThanOrEqual(400)

          // Concurrent duplicate dispatch from two windows admits one durable task.
          const [first, second] = yield* Fx.promise(() =>
            Promise.all(
              ["chat-1-race", "chat-1-race"].map((dispatchKey) =>
                Server.Default().app.request(`/api/session/${chats[1]}/task`, {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-opencode-directory": directory },
                  body: JSON.stringify({ dispatchKey, brief: brief(7) }),
                }),
              ),
            ),
          )
          expect(first.status).toBe(200)
          expect(second.status).toBe(200)
          expect((yield* body<{ data: { id: string } }>(first)).data.id).toBe(
            (yield* body<{ data: { id: string } }>(second)).data.id,
          )

          // Release every held worker and observe durable settlement. New latches
          // appear while slots refill (the raced task), so release on every poll.
          yield* pollWithTimeout(
            Fx.gen(function* () {
              for (const latch of latches.values()) yield* Deferred.succeed(latch, undefined)
              for (const [index, sessionID] of chats.entries()) {
                const counts = yield* countsOf(sessionID, directory)
                const want = index === 1 ? 6 : 5
                if ((counts.completed ?? 0) !== want) return undefined
              }
              return true
            }),
            "held workers never settled after their latches were released",
            "10 seconds",
          )

          // A6/A15: results persist; each task appears exactly once with evidence.
          const listed = yield* http(`/api/session/${chats[0]}/task`, directory).pipe(
            Fx.andThen(body<{ data: { task: { id: string; status: string } }[]; team: { paused: boolean } }>),
          )
          expect(listed.team.paused).toBe(false)
          expect(listed.data).toHaveLength(5)
          expect(new Set(listed.data.map((item) => item.task.id)).size).toBe(5)
          expect(listed.data.every((item) => item.task.status === "completed")).toBe(true)
          const details = yield* http(`/api/session/${chats[0]}/task/${expectedFirst}`, directory).pipe(
            Fx.andThen(
              body<{ data: { task: { status: string; brief: ReturnType<typeof brief> }; evidence?: string } }>,
            ),
          )
          expect(details.data.task.status).toBe("completed")
          expect(details.data.evidence).toContain("Held worker finished")
          expect(details.data.task.brief.execution.agent).toBe("michael")
          expect(details.data.task.brief.execution.model).toMatchObject({
            id: "lead-model",
            providerID: "lead-provider",
          })
          expect(
            "variant" in details.data.task.brief.execution.model && details.data.task.brief.execution.model.variant,
          ).toBe("max")

          const completedRetry = yield* post(`/api/session/${chats[0]}/task/${expectedFirst}/retry`, directory, {
            generation: 1,
          })
          expect(completedRetry.status).toBe(409)

          // Phase B — A7/A16: scoped cancellation, per-chat pause, chat isolation.
          const chatA = yield* createSession(directory)
          const chatB = yield* createSession(directory)
          const ids = new Map<string, string>()
          for (const [chatName, sessionID] of [
            ["a", chatA],
            ["b", chatB],
          ] as const) {
            for (let taskIndex = 0; taskIndex < 5; taskIndex++)
              ids.set(
                `${chatName}-${taskIndex}`,
                yield* dispatchTask(sessionID, `${chatName}-${taskIndex}`, taskIndex, directory),
              )
          }
          for (const sessionID of [chatA, chatB])
            yield* expectCounts(
              sessionID,
              directory,
              { running: 3, queued: 2 },
              "a chat never reached three running and two queued tasks",
            )

          // Pause chat B, then cancel its running task: the freed slot must not
          // refill while the team is paused.
          const paused = yield* post(`/api/session/${chatB}/task/pause`, directory, {})
          expect(paused.status).toBe(200)
          expect((yield* body<{ data: { paused: boolean } }>(paused)).data.paused).toBe(true)
          const cancelledB = yield* post(`/api/session/${chatB}/task/${ids.get("b-0")}/cancel`, directory, {})
          expect(cancelledB.status).toBe(200)
          yield* expectCounts(
            chatB,
            directory,
            { cancelled: 1, running: 2, queued: 2 },
            "paused chat refilled the cancelled slot instead of holding the queue",
          )

          // Chat A is untouched by chat B's pause and cancellation.
          const countsA = yield* countsOf(chatA, directory)
          expect(countsA.running).toBe(3)
          expect(countsA.queued).toBe(2)

          // Resuming refills chat B from its own queue.
          const resumed = yield* post(`/api/session/${chatB}/task/resume`, directory, {})
          expect(resumed.status).toBe(200)
          expect((yield* body<{ data: { paused: boolean } }>(resumed)).data.paused).toBe(false)
          yield* expectCounts(
            chatB,
            directory,
            { cancelled: 1, running: 3, queued: 1 },
            "resumed chat never refilled its third slot",
          )

          // A7: cancelling in chat A refills from chat A's queue only.
          const cancelledA = yield* post(`/api/session/${chatA}/task/${ids.get("a-0")}/cancel`, directory, {})
          expect(cancelledA.status).toBe(200)
          yield* expectCounts(
            chatA,
            directory,
            { cancelled: 1, running: 3, queued: 1 },
            "chat A never refilled its cancelled slot",
          )
          const countsBAgain = yield* countsOf(chatB, directory)
          expect(countsBAgain.running).toBe(3)
          expect(countsBAgain.queued).toBe(1)

          // A16: a chat cannot read or cancel another chat's task through the API.
          const foreignGet = yield* http(`/api/session/${chatB}/task/${ids.get("a-0")}`, directory)
          expect(foreignGet.status).toBeGreaterThanOrEqual(400)
          const foreignCancel = yield* post(`/api/session/${chatB}/task/${ids.get("a-1")}/cancel`, directory, {})
          expect(foreignCancel.status).toBeGreaterThanOrEqual(400)
          const foreignStillRunning = yield* countsOf(chatA, directory)
          expect(foreignStillRunning.cancelled).toBe(1)

          // Replay: committed transitions replay after a cursor, nothing past it.
          const events = yield* http(`/api/session/${chatA}/task-events?after=0`, directory).pipe(
            Fx.andThen(body<{ data: { seq: number; kind: string }[] }>),
          )
          expect(events.data.length).toBeGreaterThan(0)
          expect(events.data.map((event) => event.kind)).toContain("admitted")
          expect(events.data.map((event) => event.kind)).toContain("claimed")
          const pastCursor = yield* http(`/api/session/${chatA}/task-events?after=1000000`, directory).pipe(
            Fx.andThen(body<{ data: unknown[] }>),
          )
          expect(pastCursor.data).toEqual([])

          // These chats hold no interactions, and answers to unknown interactions fail.
          const interactions = yield* http(`/api/session/${chatA}/task-interactions`, directory).pipe(
            Fx.andThen(body<{ data: unknown[] }>),
          )
          expect(interactions.data).toEqual([])
          const badAnswer = yield* post(`/api/session/${chatA}/task-interactions/tin_missing_interaction`, directory, {
            generation: 1,
            decision: { kind: "question-rejection" },
          })
          expect(badAnswer.status).toBeGreaterThanOrEqual(400)

          // Release everything so no held worker outlives the test. Queued work
          // claims freed slots and opens fresh latches, so release on every poll.
          yield* pollWithTimeout(
            Fx.gen(function* () {
              for (const latch of latches.values()) yield* Deferred.succeed(latch, undefined)
              for (const sessionID of [chatA, chatB]) {
                const counts = yield* countsOf(sessionID, directory)
                if ((counts.completed ?? 0) !== 4 || (counts.cancelled ?? 0) !== 1) return undefined
              }
              return true
            }),
            "held workers never settled after their latches were released",
            "10 seconds",
          )
          const ledger = yield* TaskLedger.Service
          const recovery = yield* ledger.admit({
            ownerSessionID: SessionID.make(chats[0]),
            dispatchKey: "legacy-recovery",
            brief: {
              ...brief(99),
              execution: {
                ...brief(99).execution,
                agent: "michael",
                model: { id: "lead-model", providerID: "lead-provider", variant: "max" },
              },
            },
          })
          const previous = yield* ledger.claim({
            ownerSessionID: SessionID.make(chats[0]),
            runtimeEpoch: "legacy-test-host",
          })
          expect(previous).toBeDefined()
          yield* ledger.interruptEpoch("legacy-test-host")
          const interrupted = yield* ledger.get({ ownerSessionID: SessionID.make(chats[0]), taskID: recovery.id })
          const denied = yield* post(`/api/session/${chats[0]}/task/${recovery.id}/retry`, directory, {
            generation: interrupted.generation,
          })
          expect(denied.status).toBe(503)
          const recovered = yield* post(`/api/session/${chats[0]}/task/${recovery.id}/retry`, directory, {
            generation: interrupted.generation,
            confirmStopped: true,
          })
          expect(recovered.status).toBe(200)
          yield* pollWithTimeout(
            Fx.gen(function* () {
              for (const latch of latches.values()) yield* Deferred.succeed(latch, undefined)
              const detail = yield* ledger.details({ ownerSessionID: SessionID.make(chats[0]), taskID: recovery.id })
              if (detail.task.status !== "completed") return
              expect(detail.attempt?.workerSessionID).not.toBe(previous?.workerSessionID)
              return true
            }),
            "explicit recovery never completed",
            "10 seconds",
          )

          // Historical briefs are immutable, so retry must not resurrect a
          // pre-Michael Build worker under Michael Lead.
          const obsolete = yield* ledger.admit({
            ownerSessionID: SessionID.make(chats[0]),
            dispatchKey: "pre-michael-recovery",
            brief: brief(100),
          })
          yield* ledger.claim({ ownerSessionID: SessionID.make(chats[0]), runtimeEpoch: "obsolete-worker-host" })
          yield* ledger.interruptEpoch("obsolete-worker-host")
          const old = yield* ledger.get({ ownerSessionID: SessionID.make(chats[0]), taskID: obsolete.id })
          const rejected = yield* post(`/api/session/${chats[0]}/task/${obsolete.id}/retry`, directory, {
            generation: old.generation,
            confirmStopped: true,
          })
          expect(rejected.status).toBe(400)
          expect((yield* ledger.get({ ownerSessionID: SessionID.make(chats[0]), taskID: obsolete.id })).status).toBe(
            "interrupted",
          )
          yield* ledger.reconcile({
            ownerSessionID: SessionID.make(chats[0]),
            taskID: obsolete.id,
            generation: old.generation,
            evidence: "The synthetic old host never executed provider work; fixture ownership is released",
          })
        }),
      30_000,
    )
  })
