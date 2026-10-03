export * as TaskExecution from "./execution"

import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Schema,
  Scope,
  Semaphore,
  SynchronizedRef,
} from "effect"
import { Task } from "@opencode-ai/schema/task"
import { SessionID } from "@opencode-ai/schema/session-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskInteraction } from "@opencode-ai/schema/task-interaction"
import { makeGlobalNode } from "../effect/app-node"
import { TaskLedger } from "./ledger"
import { TaskInteractionStore } from "./interaction"
import { runtimeEpoch, runtimeHostAlive } from "./runtime-host"

export class Error extends Schema.TaggedErrorClass<Error>()("TaskExecution.Error", {
  message: Schema.String,
}) {}

export type Result = {
  readonly summary: string
  readonly checks: ReadonlyArray<{ readonly check: string; readonly passed: boolean; readonly evidence: string }>
}
export type Budget = { readonly call: Effect.Effect<void, Error> }
export type Driver = {
  readonly engine: Task.Execution["engine"]
  readonly directory: AbsolutePath
  /** Must enforce call admission immediately before each provider invocation. */
  readonly run: (task: Task.Info, attempt: Task.Attempt, budget: Budget) => Effect.Effect<Result, unknown>
  readonly verify?: (task: Task.Info, result: Result, attempt: Task.Attempt) => Effect.Effect<Result, unknown>
  /** Must join Session/tool/process cleanup; failure retains durable ownership. */
  readonly cleanup: (attempt: Task.Attempt) => Effect.Effect<string, unknown>
}
export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@opencode/TaskExecution") {}

export const make = Effect.fn("TaskExecution.make")(function* (input: {
  readonly ledger: TaskLedger.Interface
  readonly invalidate: (attempt: Task.Attempt, reason: string) => Effect.Effect<unknown, unknown>
  readonly runtimeEpoch: string
  readonly hostAlive?: (epoch: string) => Effect.Effect<boolean | undefined>
}) {
  const scope = yield* Scope.Scope
  const epoch = yield* Schema.decodeUnknownEffect(Task.RuntimeEpoch)(input.runtimeEpoch).pipe(Effect.orDie)
  const queue = yield* Queue.unbounded<SessionID>()
  const pending = new Set<SessionID>()
  const drivers = new Map<string, Driver>()
  const hosts = new Map<Task.Execution["engine"], (owner: SessionID) => Effect.Effect<void, unknown>>()
  const deliveries = new Map<
    TaskInteraction.Format,
    (interaction: TaskInteraction.Info, decision: TaskInteraction.Decision) => Effect.Effect<void, unknown>
  >()
  const repositories = new Map<Task.Execution["engine"], (owner: SessionID) => Effect.Effect<string, unknown>>()
  const active = new Map<Task.ID, { attempt: Task.Attempt; fiber: Fiber.Fiber<void, unknown> }>()
  const busy = new Map<SessionID, Deferred.Deferred<void>>()
  const errors = new Map<SessionID, string>()
  const budgets = new Map<SessionID, { budget: Budget; execution: Task.Execution; attempt: Task.Attempt }>()
  const guards = new Set<Task.Execution["engine"]>()
  const permissionGuards = new Set<Task.Execution["engine"]>()
  const codingServices = new Set<"format" | "lsp">()
  const networkGuard = { installed: false }
  const placements = new Map<SessionID, AbsolutePath>()
  const toolCalls = new Map<SessionID, number>()
  const models = new Map<SessionID, { readonly id: string; readonly providerID: string }>()
  const networkCalls = new Map<SessionID, number>()
  const lifecycle = { closing: false, generation: 0 }
  const hostGate = yield* Semaphore.make(1)
  const waits = yield* SynchronizedRef.make(
    new Map<SessionID, { count: number; phase: "running" | "verifying"; attempt: Task.Attempt }>(),
  )
  const key = (engine: string, directory: string) => JSON.stringify([engine, directory])
  const wake = Effect.fn("TaskExecution.wake")(function* (owner: SessionID) {
    if (lifecycle.closing) return
    if (!busy.has(owner)) busy.set(owner, yield* Deferred.make<void>())
    if (pending.has(owner)) return
    pending.add(owner)
    yield* Queue.offer(queue, owner)
  })
  const done = Effect.fnUntraced(function* (owner: SessionID) {
    if (pending.has(owner) || [...active.values()].some((entry) => entry.attempt.ownerSessionID === owner)) return
    const wait = busy.get(owner)
    busy.delete(owner)
    if (wait) yield* Deferred.succeed(wait, undefined)
  })

  const run = (task: Task.Info, attempt: Task.Attempt, driver: Driver) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const execution = task.brief.execution
        if (!execution) return yield* Effect.die("Claimed an unconfigured task")
        const calls = { count: 0 }
        const budget: Budget = {
          call: Effect.suspend(() =>
            calls.count++ < execution.maxCalls
              ? Effect.void
              : Effect.fail(new Error({ message: "Provider call budget exhausted" })),
          ),
        }
        budgets.set(attempt.workerSessionID, { budget, execution, attempt })
        const outcome = yield* Effect.exit(
          restore(
            input.ledger.transition(attempt, "running").pipe(
              Effect.andThen(driver.run(task, attempt, budget)),
              Effect.flatMap((result) =>
                input.ledger
                  .transition(attempt, "verifying")
                  .pipe(Effect.andThen(driver.verify ? driver.verify(task, result, attempt) : Effect.succeed(result))),
              ),
              Effect.timeout(execution.wallClockMs),
            ),
          ),
        )
        // Cleanup runs even on timeout/interrupt. Its failure never frees a slot.
        const cleanup = yield* Effect.exit(driver.cleanup(attempt))
        if (Exit.isFailure(cleanup) || !Exit.isSuccess(cleanup) || !cleanup.value.trim()) {
          errors.set(attempt.ownerSessionID, "Cleanup could not prove quiescence; slot retained")
          yield* input.ledger.interruptAttempt(attempt, "Cleanup could not prove quiescence; slot retained")
          return
        }
        const current = yield* input.ledger.get({ ownerSessionID: attempt.ownerSessionID, taskID: task.id })
        if (current.generation !== attempt.generation || current.status === "interrupted") return
        if (Exit.isFailure(outcome) && Cause.hasInterruptsOnly(outcome.cause) && current.status !== "cancelling") {
          yield* input.ledger.interruptAttempt(attempt)
          return
        }
        yield* input.invalidate(attempt, current.status === "cancelling" ? "Task cancelled" : "Worker execution ended")
        const evidence = Exit.isSuccess(outcome)
          ? outcome.value
          : { error: Cause.pretty(outcome.cause).slice(0, 4_000) }
        const valid =
          Exit.isSuccess(outcome) &&
          outcome.value.summary.trim().length > 0 &&
          outcome.value.summary.length <= 8_000 &&
          outcome.value.checks.length === task.brief.checks.length &&
          task.brief.checks.every(
            (check) =>
              outcome.value.checks.filter((item) => item.check === check && item.passed && item.evidence.trim())
                .length === 1,
          )
        const serialized = JSON.stringify({ result: evidence, cleanup: cleanup.value })
        yield* input.ledger.settle(attempt, {
          outcome:
            current.status === "cancelling"
              ? "cancelled"
              : valid && serialized.length <= 20_000
                ? "completed"
                : "failed",
          evidence:
            serialized.length <= 20_000
              ? serialized
              : JSON.stringify({
                  error: "Result exceeds durable handoff limit",
                  cleanup: cleanup.value.slice(0, 2_000),
                }),
        })
      }),
    )

  yield* Effect.forever(
    Effect.gen(function* () {
      const owner = yield* Queue.take(queue)
      pending.delete(owner)
      yield* Effect.gen(function* () {
        if (lifecycle.closing) return
        // Inspect the next FIFO item before claiming. Missing drivers/config never
        // consume a slot, and no existing chat is silently adopted.
        const next = yield* input.ledger.peek(owner)
        if (!next?.brief.execution) return
        if (!drivers.has(key(next.brief.execution.engine, next.location.directory))) {
          const host = hosts.get(next.brief.execution.engine)
          if (host) yield* host(owner)
        }
        const driver = drivers.get(key(next.brief.execution.engine, next.location.directory))
        if (!driver) return
        const attempt = yield* input.ledger.claim({ ownerSessionID: owner, runtimeEpoch: epoch })
        if (!attempt) return
        const task = yield* input.ledger.get({ ownerSessionID: owner, taskID: attempt.taskID })
        const fiber = yield* run(task, attempt, driver).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              errors.set(owner, Cause.pretty(cause))
            }).pipe(
              Effect.andThen(input.ledger.interruptAttempt(attempt, Cause.pretty(cause).slice(0, 4_000))),
              Effect.ignore,
            ),
          ),
          Effect.ensuring(
            Effect.gen(function* () {
              budgets.delete(attempt.workerSessionID)
              placements.delete(attempt.workerSessionID)
              toolCalls.delete(attempt.workerSessionID)
              models.delete(attempt.workerSessionID)
              networkCalls.delete(attempt.workerSessionID)
              active.delete(attempt.taskID)
              yield* wake(owner)
            }),
          ),
          Effect.forkIn(scope),
        )
        active.set(attempt.taskID, { attempt, fiber })
        yield* wake(owner)
      }).pipe(
        hostGate.withPermit,
        Effect.uninterruptible,
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            errors.set(owner, Cause.pretty(cause))
          }),
        ),
      )
      yield* done(owner)
    }),
  ).pipe(Effect.forkIn(scope))

  const shutdown = Effect.fn("TaskExecution.shutdown")(function* () {
    lifecycle.closing = true
    yield* input.ledger.interruptEpoch(epoch)
    yield* Effect.forEach([...active.values()], (entry) => Fiber.interrupt(entry.fiber), {
      concurrency: "unbounded",
      discard: true,
    })
    yield* Queue.shutdown(queue)
  })
  yield* Effect.addFinalizer(() => shutdown().pipe(Effect.orDie))

  return {
    runtimeEpoch: epoch,
    withWait: <A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const leased = yield* SynchronizedRef.modifyEffect(waits, (current) =>
            Effect.gen(function* () {
              const entry = budgets.get(sessionID)
              if (!entry) return [false, current] as const
              const existing = current.get(sessionID)
              if (existing)
                return [true, new Map(current).set(sessionID, { ...existing, count: existing.count + 1 })] as const
              const task = yield* input.ledger.get({
                ownerSessionID: entry.attempt.ownerSessionID,
                taskID: entry.attempt.taskID,
              })
              if (task.status !== "running" && task.status !== "verifying")
                return yield* new Error({ message: "Worker cannot open a human wait in this state" })
              yield* input.ledger.transition(entry.attempt, "waiting_for_user")
              return [
                true,
                new Map(current).set(sessionID, { count: 1, phase: task.status, attempt: entry.attempt }),
              ] as const
            }),
          ).pipe(Effect.orDie)
          return yield* restore(effect).pipe(
            Effect.ensuring(
              leased
                ? SynchronizedRef.updateEffect(waits, (current) =>
                    Effect.gen(function* () {
                      const entry = current.get(sessionID)
                      if (!entry) return current
                      if (entry.count > 1) return new Map(current).set(sessionID, { ...entry, count: entry.count - 1 })
                      const next = new Map(current)
                      next.delete(sessionID)
                      const task = yield* input.ledger.get({
                        ownerSessionID: entry.attempt.ownerSessionID,
                        taskID: entry.attempt.taskID,
                      })
                      if (task.generation === entry.attempt.generation && task.status === "waiting_for_user")
                        yield* input.ledger.transition(entry.attempt, entry.phase)
                      return next
                    }),
                  ).pipe(Effect.orDie)
                : Effect.void,
            ),
          )
        }),
      ),
    attachRepository: (
      engine: Task.Execution["engine"],
      revision: (owner: SessionID) => Effect.Effect<string, unknown>,
    ) =>
      Effect.sync(() => {
        repositories.set(engine, revision)
      }),
    capture: (owner: SessionID, policy: Task.Execution) =>
      Effect.gen(function* () {
        if (policy.mode !== "coding" || policy.baseRevision) return policy
        const revision = repositories.get(policy.engine)
        if (!revision) return yield* new Error({ message: "The owning engine cannot capture a safe repository base" })
        return { ...policy, baseRevision: yield* revision(owner) }
      }),
    attachDelivery: (
      format: TaskInteraction.Format,
      deliver: (interaction: TaskInteraction.Info, decision: TaskInteraction.Decision) => Effect.Effect<void, unknown>,
    ) =>
      Effect.suspend(() => {
        if (deliveries.has(format))
          return Effect.fail(new Error({ message: "Native interaction delivery is already attached" }))
        deliveries.set(format, deliver)
        return Effect.void
      }),
    deliver: (interaction: TaskInteraction.Info, decision: TaskInteraction.Decision) =>
      Effect.suspend(() => {
        const deliver = deliveries.get(interaction.format)
        return deliver
          ? deliver(interaction, decision)
          : Effect.fail(new Error({ message: "No safe native continuation is attached for this interaction" }))
      }),
    attachHost: (engine: Task.Execution["engine"], prepare: (owner: SessionID) => Effect.Effect<void, unknown>) =>
      Effect.suspend(() => {
        if (hosts.has(engine))
          return Effect.fail(new Error({ message: "Execution host already attached for this engine" }))
        hosts.set(engine, prepare)
        return Effect.void
      }),
    generation: () => lifecycle.generation,
    reload: <A, E, R>(effect: Effect.Effect<A, E, R>, directory?: string) =>
      hostGate.withPermit(
        Effect.gen(function* () {
          const live = yield* input.ledger.live()
          const pinned = directory
            ? (yield* Effect.forEach(live, (attempt) =>
                input.ledger.get({ ownerSessionID: attempt.ownerSessionID, taskID: attempt.taskID }),
              )).some((task) => task.location.directory === directory) ||
              [...placements.values()].some((placement) => placement === directory)
            : live.length > 0
          if (pinned)
            return yield* new Error({
              message: "Workers retain durable ownership; cancel/reconcile tasks before reloading projects",
            })
          return yield* effect.pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                for (const [key, driver] of drivers) {
                  if (!directory || driver.directory === directory) drivers.delete(key)
                }
                lifecycle.generation++
                yield* Effect.forEach(yield* input.ledger.readyOwners(), wake, { discard: true })
              }).pipe(Effect.orDie),
            ),
          )
        }).pipe(Effect.uninterruptible),
      ),
    prepare: (owner: SessionID, engine: Task.Execution["engine"]) =>
      hostGate.withPermit(
        Effect.suspend(() => {
          const host = hosts.get(engine)
          return host
            ? host(owner)
            : Effect.fail(new Error({ message: "No execution host is attached for the requested engine" }))
        }),
      ),
    hasDriver: (engine: Task.Execution["engine"], directory: string) =>
      Effect.sync(() => drivers.has(key(engine, directory))),
    inHostScope: <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
      effect.pipe(Effect.provideService(Scope.Scope, scope)),
    shutdown,
    wake,
    bindWorkspace: (attempt: Task.Attempt, directory: AbsolutePath) =>
      Effect.gen(function* () {
        const entry = budgets.get(attempt.workerSessionID)
        if (
          !entry ||
          entry.attempt.id !== attempt.id ||
          entry.attempt.generation !== attempt.generation ||
          entry.execution.mode !== "coding"
        )
          return yield* new Error({ message: "Cannot bind workspace outside a live coding attempt" })
        const task = yield* input.ledger.get({ ownerSessionID: attempt.ownerSessionID, taskID: attempt.taskID })
        if (directory === task.location.directory || directory.startsWith(task.location.directory + "/"))
          return yield* new Error({ message: "Coding workspace must be outside the user's root checkout" })
        placements.set(attempt.workerSessionID, directory)
      }),
    releaseWorkspace: (attempt: Task.Attempt) =>
      Effect.gen(function* () {
        const entry = budgets.get(attempt.workerSessionID)
        if (!entry || entry.attempt.id !== attempt.id)
          return yield* new Error({ message: "Workspace cleanup does not belong to a live process attempt" })
        placements.delete(attempt.workerSessionID)
      }),
    isWorker: (sessionID: SessionID) =>
      input.ledger.worker(sessionID).pipe(Effect.map((attempt) => attempt !== undefined)),
    bindModel: (attempt: Task.Attempt, model: { readonly id: string; readonly providerID: string }) =>
      Effect.suspend(() => {
        const entry = budgets.get(attempt.workerSessionID)
        if (!entry || entry.attempt.id !== attempt.id)
          return Effect.fail(new Error({ message: "Model binding does not belong to a live worker" }))
        models.set(attempt.workerSessionID, model)
        return Effect.void
      }),
    assertModel: (sessionID: SessionID, model: { readonly id: string; readonly providerID: string }) =>
      Effect.suspend(() => {
        const entry = budgets.get(sessionID)
        if (!entry) return Effect.fail(new Error({ message: "Worker no longer owns live execution" }))
        const expected = models.get(sessionID) ?? entry.execution.model
        return expected.id === model.id && expected.providerID === model.providerID
          ? Effect.void
          : Effect.fail(
              new Error({ message: "Worker model changed from the accepted selection; no automatic substitution" }),
            )
      }),
    beforeTool: (sessionID: SessionID) =>
      Effect.suspend(() => {
        const entry = budgets.get(sessionID)
        if (!entry) return Effect.fail(new Error({ message: "Worker no longer owns live execution" }))
        const count = toolCalls.get(sessionID) ?? 0
        if (count >= (entry.execution.maxToolCalls ?? entry.execution.maxCalls * 20))
          return Effect.fail(new Error({ message: "Worker tool call budget exhausted" }))
        toolCalls.set(sessionID, count + 1)
        return Effect.void
      }),
    beforeNetwork: (sessionID: SessionID) =>
      Effect.gen(function* () {
        const entry = budgets.get(sessionID)
        if (!entry) {
          if (yield* input.ledger.worker(sessionID))
            return yield* new Error({ message: "Worker no longer owns live execution" })
          return
        }
        const task = yield* input.ledger.get({
          ownerSessionID: entry.attempt.ownerSessionID,
          taskID: entry.attempt.taskID,
        })
        if (task.generation !== entry.attempt.generation || !["running", "waiting_for_user"].includes(task.status))
          return yield* new Error({ message: "Worker no longer owns live execution" })
        const count = networkCalls.get(sessionID) ?? 0
        if (count >= entry.execution.maxCalls)
          return yield* new Error({ message: "Worker network call budget exhausted" })
        networkCalls.set(sessionID, count + 1)
      }),
    pinned: Effect.fn("TaskExecution.pinned")(function* (directory: string) {
      const live = yield* input.ledger.live()
      const tasks = yield* Effect.forEach(live, (attempt) =>
        input.ledger.get({ ownerSessionID: attempt.ownerSessionID, taskID: attempt.taskID }),
      )
      return (
        tasks.some((task) => task.location.directory === directory) ||
        [...placements.values()].includes(AbsolutePath.make(directory))
      )
    }),
    isWorkspace: (directory: string) =>
      Effect.sync(() => [...placements.values()].includes(AbsolutePath.make(directory))),
    workspaceRoot: (directory: string) =>
      Effect.gen(function* () {
        const sessionID = [...placements.entries()].find((entry) => entry[1] === directory)?.[0]
        const entry = sessionID ? budgets.get(sessionID) : undefined
        if (!entry) return
        const task = yield* input.ledger.get({
          ownerSessionID: entry.attempt.ownerSessionID,
          taskID: entry.attempt.taskID,
        })
        return { directory: task.location.directory, projectID: task.projectID }
      }),
    workerContext: Effect.fn("TaskExecution.workerContext")(function* (sessionID: SessionID) {
      const entry = budgets.get(sessionID)
      if (!entry) {
        if (yield* input.ledger.worker(sessionID))
          return yield* new Error({ message: "Worker no longer owns live execution" })
        return
      }
      const task = yield* input.ledger.get({
        ownerSessionID: entry.attempt.ownerSessionID,
        taskID: entry.attempt.taskID,
      })
      if (
        task.generation !== entry.attempt.generation ||
        !["running", "waiting_for_user", "verifying"].includes(task.status)
      )
        return yield* new Error({ message: "Worker no longer owns live execution" })
      return {
        task,
        attempt: entry.attempt,
        execution: entry.execution,
        directory: placements.get(sessionID) ?? task.location.directory,
      }
    }),
    // Called only while constructing the decorated provider service. Drivers
    // fail closed if bootstrap omitted this mandatory boundary.
    installGuard: (engine: Task.Execution["engine"]) => {
      guards.add(engine)
    },
    installNetworkGuard: () => {
      networkGuard.installed = true
    },
    requireNetworkGuard: () =>
      Effect.suspend(() =>
        networkGuard.installed
          ? Effect.void
          : Effect.fail(new Error({ message: "Worker network budget guard is not installed" })),
      ),
    installPermissionGuard: (engine: Task.Execution["engine"]) => {
      permissionGuards.add(engine)
    },
    requirePermissionGuard: (engine: Task.Execution["engine"]) =>
      Effect.suspend(() =>
        permissionGuards.has(engine)
          ? Effect.void
          : Effect.fail(new Error({ message: `Worker native permission guard is not installed for ${engine}` })),
      ),
    installCodingServiceGuard: (service: "format" | "lsp") => {
      codingServices.add(service)
    },
    requireCodingServiceGuards: () =>
      Effect.suspend(() =>
        codingServices.size === 2
          ? Effect.void
          : Effect.fail(new Error({ message: "V1 coding requires isolated formatter and LSP guards" })),
      ),
    requireGuard: (engine: Task.Execution["engine"]) =>
      Effect.suspend(() =>
        guards.has(engine)
          ? Effect.void
          : Effect.fail(new Error({ message: `Worker provider guard is not installed for ${engine}` })),
      ),
    beforeCall: Effect.fn("TaskExecution.beforeCall")(function* (
      sessionID: SessionID,
      engine?: Task.Execution["engine"],
    ) {
      const entry = budgets.get(sessionID)
      if (!entry) {
        if (yield* input.ledger.worker(sessionID))
          return yield* new Error({ message: "Worker no longer owns live execution" })
        return
      }
      // V1's optional native transport crosses both provider services. Charge
      // once at its V1 boundary, not again in the canonical V2 client decorator.
      if (engine && engine !== entry.execution.engine) return
      const task = yield* input.ledger.get({
        ownerSessionID: entry.attempt.ownerSessionID,
        taskID: entry.attempt.taskID,
      })
      if (task.generation !== entry.attempt.generation || !["running", "waiting_for_user"].includes(task.status))
        return yield* new Error({ message: "Worker no longer owns live execution" })
      yield* entry.budget.call
      return entry.execution
    }),
    dispatch: Effect.fn("TaskExecution.dispatch")((dispatch: Task.Dispatch) =>
      Effect.gen(function* () {
        if (lifecycle.closing) return yield* new Error({ message: "Execution host is shutting down" })
        if (!dispatch.brief.execution)
          return yield* new Error({ message: "Dispatch requires an immutable execution snapshot" })
        if (
          dispatch.brief.execution.mode === "coding" &&
          (!dispatch.brief.execution.baseRevision || !dispatch.brief.execution.paths?.length)
        )
          return yield* new Error({ message: "Coding dispatch requires accepted base revision and immutable paths" })
        const task = yield* input.ledger.admit(dispatch)
        yield* wake(task.ownerSessionID)
        return task
      }).pipe(Effect.uninterruptible),
    ),
    register: Effect.fn("TaskExecution.register")((driver: Driver) =>
      Effect.gen(function* () {
        const id = key(driver.engine, driver.directory)
        if (drivers.has(id))
          return yield* new Error({ message: "Driver already registered for this engine and placement" })
        drivers.set(id, driver)
        yield* Effect.forEach(yield* input.ledger.readyOwners(), wake, { discard: true })
      }),
    ),
    cancel: Effect.fn("TaskExecution.cancel")((owned: { ownerSessionID: SessionID; taskID: Task.ID }) =>
      Effect.gen(function* () {
        const task = yield* input.ledger.cancel(owned)
        const entry = active.get(task.id)
        const attempt = entry?.attempt ?? (yield* input.ledger.live()).find((attempt) => attempt.taskID === task.id)
        yield* (attempt ? input.invalidate(attempt, "Task cancelled") : Effect.void).pipe(
          Effect.ensuring(entry ? Fiber.interrupt(entry.fiber) : Effect.void),
        )
        yield* wake(owned.ownerSessionID)
        return yield* input.ledger.get(owned)
      }).pipe(Effect.uninterruptible),
    ),
    pause: (owner: SessionID) => input.ledger.setPaused(owner, true).pipe(Effect.asVoid),
    resume: (owner: SessionID) => input.ledger.setPaused(owner, false).pipe(Effect.andThen(wake(owner))),
    retry: Effect.fn("TaskExecution.retry")(function* (owned: {
      ownerSessionID: SessionID
      taskID: Task.ID
      generation: number
      confirmStopped?: boolean
      reviewedChanges?: boolean
    }) {
      const task = yield* input.ledger.get(owned)
      if (task.generation !== owned.generation)
        return yield* new Error({ message: "Retry refers to an older worker generation" })
      if (task.brief.execution?.mode === "native" && !owned.reviewedChanges)
        return yield* new Error({
          message: "Review native worker side effects before retrying; work is not replayed automatically",
        })
      if (task.status === "interrupted") {
        const attempt = (yield* input.ledger.live()).find((item) => item.taskID === task.id)
        if (!attempt || attempt.runtimeEpoch === epoch || active.has(task.id))
          return yield* new Error({ message: "The current host still owns worker cleanup" })
        const alive = input.hostAlive ? yield* input.hostAlive(attempt.runtimeEpoch) : undefined
        if (alive === true) return yield* new Error({ message: "The previous worker host is still running" })
        if (alive === undefined && !owned.confirmStopped)
          return yield* new Error({ message: "Confirm the previous app/process stopped before recovering this worker" })
        if (task.brief.execution?.mode === "coding" && !owned.reviewedChanges)
          return yield* new Error({ message: "Review workspace changes before retrying interrupted coding work" })
        yield* input.invalidate(attempt, "Interrupted worker explicitly recovered")
        yield* input.ledger.reconcile({
          ...owned,
          evidence: JSON.stringify({
            result: { error: "Previous worker interrupted; user explicitly requested a new attempt" },
            cleanup:
              alive === false
                ? "Operating system confirmed previous host exited"
                : "User confirmed previous host stopped and reviewed required side effects",
          }),
        })
      }
      const next = yield* input.ledger.retry(owned)
      yield* wake(owned.ownerSessionID)
      return next
    }),
    idle: (owner: SessionID) =>
      Effect.suspend(() => {
        const wait = busy.get(owner)
        return wait ? Deferred.await(wait) : Effect.void
      }),
    error: (owner: SessionID) => Effect.sync(() => errors.get(owner)),
    startup: Effect.fn("TaskExecution.startup")(function* () {
      const live = yield* input.ledger.live()
      yield* Effect.forEach(
        [...new Set(live.filter((attempt) => attempt.runtimeEpoch !== epoch).map((attempt) => attempt.runtimeEpoch))],
        (previous) =>
          Effect.gen(function* () {
            const alive = input.hostAlive ? yield* input.hostAlive(previous) : undefined
            if (alive === true) return
            yield* input.ledger.interruptEpoch(previous)
            yield* Effect.forEach(
              live.filter((attempt) => attempt.runtimeEpoch === previous),
              (attempt) =>
                Effect.gen(function* () {
                  yield* input.invalidate(attempt, "Previous worker host interrupted")
                  const task = yield* input.ledger.get({
                    ownerSessionID: attempt.ownerSessionID,
                    taskID: attempt.taskID,
                  })
                  if (
                    alive !== false ||
                    task.brief.execution?.mode === "coding" ||
                    task.brief.execution?.mode === "native"
                  )
                    return
                  yield* input.ledger.reconcile({
                    ownerSessionID: task.ownerSessionID,
                    taskID: task.id,
                    generation: task.generation,
                    evidence: JSON.stringify({
                      result: { error: "Previous host exited; unfinished work was not replayed" },
                      cleanup: "Operating system confirmed previous host exited; read-only attempt released",
                    }),
                  })
                }),
            )
          }),
      )
      yield* Effect.forEach(yield* input.ledger.readyOwners(), wake, { discard: true })
    }),
  }
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ledger = yield* TaskLedger.Service
    const interactions = yield* TaskInteractionStore.Service
    return yield* make({
      ledger,
      runtimeEpoch: runtimeEpoch(),
      hostAlive: (epoch) => Effect.sync(() => runtimeHostAlive(epoch)),
      invalidate: (attempt, reason) =>
        interactions.invalidate({ ownerSessionID: attempt.ownerSessionID, attemptID: attempt.id, reason }),
    })
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [TaskLedger.node, TaskInteractionStore.node] })
