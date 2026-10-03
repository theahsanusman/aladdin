import { Effect, Exit, Scope } from "effect"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { Task } from "@opencode-ai/schema/task"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskWorkspace } from "./workspace"

/** open builds the actual engine services under this app-owned child scope.
 * verify and authorize are host capabilities, never worker-provided evidence. */
export const make = Effect.fn("TaskCodingDriver.make")(function* (input: {
  readonly engine: Task.Execution["engine"]
  readonly root: AbsolutePath
  readonly storage: string
  readonly open: (directory: AbsolutePath, scope: Scope.Scope) => Effect.Effect<TaskExecution.Driver, unknown>
  readonly verify: (
    workspace: TaskWorkspace.Workspace,
    artifact: TaskWorkspace.Artifact,
    task: Task.Info,
  ) => Effect.Effect<TaskExecution.Result["checks"], unknown>
  readonly authorize: (
    task: Task.Info,
    attempt: Task.Attempt,
    artifact: TaskWorkspace.Artifact,
  ) => Effect.Effect<void, unknown>
  readonly close?: (directory: AbsolutePath, attempt: Task.Attempt) => Effect.Effect<void, unknown>
}) {
  const tasks = yield* TaskExecution.Service
  const scope = yield* Scope.Scope
  const workers = new Map<
    Task.AttemptID,
    { workspace: TaskWorkspace.Workspace; driver?: TaskExecution.Driver; scope: Scope.Closeable }
  >()
  return {
    engine: input.engine,
    directory: input.root,
    run: Effect.fn("TaskCodingDriver.run")(function* (task, attempt, budget) {
      const policy = task.brief.execution
      if (
        policy?.mode !== "coding" ||
        policy.engine !== input.engine ||
        task.location.directory !== input.root ||
        !policy.paths?.length ||
        !policy.baseRevision
      )
        return yield* new TaskExecution.Error({
          message: "Coding dispatch requires immutable paths and owning engine/root",
        })
      const workspace = yield* TaskWorkspace.create({
        root: input.root,
        storage: input.storage,
        attemptID: attempt.id,
        paths: policy.paths,
        baseRevision: policy.baseRevision,
      })
      const child = yield* Scope.fork(scope, "sequential")
      const directory = AbsolutePath.make(workspace.directory)
      workers.set(attempt.id, { workspace, scope: child })
      yield* tasks.bindWorkspace(attempt, directory)
      const driver = yield* input.open(directory, child).pipe(Effect.provideService(Scope.Scope, child))
      if (driver.directory !== directory || driver.engine !== input.engine)
        return yield* new TaskExecution.Error({ message: "Isolated driver placement mismatch" })
      workers.set(attempt.id, { workspace, driver, scope: child })
      return yield* driver.run({ ...task, location: { directory } }, attempt, budget)
    }),
    verify: Effect.fn("TaskCodingDriver.verify")(function* (task, result, attempt) {
      const worker = workers.get(attempt.id)
      if (!worker) return yield* new TaskExecution.Error({ message: "Coding workspace is not owned by this process" })
      const artifact = yield* TaskWorkspace.capture(worker.workspace)
      const checks = yield* input.verify(worker.workspace, artifact, task)
      if (
        checks.length !== task.brief.checks.length ||
        !task.brief.checks.every((check) =>
          checks.some((item) => item.check === check && item.passed && item.evidence.trim()),
        )
      )
        return {
          summary: `Verification failed; patch ${artifact.digest} retained in ${worker.workspace.directory}`,
          checks,
        }
      yield* input.authorize(task, attempt, artifact)
      // Recheck fencing after an arbitrarily long native authorization wait.
      const context = yield* tasks.workerContext(attempt.workerSessionID)
      if (!context) return yield* new TaskExecution.Error({ message: "Coding ownership lost before integration" })
      const integrated = yield* TaskWorkspace.integrate(
        worker.workspace,
        artifact,
        tasks
          .workerContext(attempt.workerSessionID)
          .pipe(
            Effect.flatMap((owner) =>
              owner
                ? Effect.void
                : Effect.fail(new TaskExecution.Error({ message: "Coding ownership lost at integration boundary" })),
            ),
          ),
        input.verify({ ...worker.workspace, directory: worker.workspace.root }, artifact, task),
      )
      return {
        summary: `${result.summary}\nIntegrated patch ${artifact.digest}; isolated workspace ${worker.workspace.directory}`,
        checks: integrated,
      }
    }),
    cleanup: Effect.fn("TaskCodingDriver.cleanup")(function* (attempt) {
      const worker = workers.get(attempt.id)
      if (!worker) return "No worker orchestration started; isolated worktree retained for inspection"
      const evidence = worker.driver
        ? yield* worker.driver.cleanup(attempt)
        : "Isolated engine initialization stopped before model execution"
      yield* tasks.releaseWorkspace(attempt)
      if (input.close) yield* input.close(AbsolutePath.make(worker.workspace.directory), attempt)
      yield* Scope.close(worker.scope, Exit.void)
      workers.delete(attempt.id)
      return `${evidence}; isolated workspace retained at ${worker.workspace.directory}`
    }),
  } satisfies TaskExecution.Driver
})

export * as TaskCodingDriver from "./coding-driver"
