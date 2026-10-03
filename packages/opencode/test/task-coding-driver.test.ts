import { expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { SessionID } from "@opencode-ai/schema/session-id"
import { TaskCodingDriver } from "../src/task/coding-driver"
import { tmpdirScoped } from "./fixture/fixture"
import { testEffect } from "./lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { installTaskInteractionSchema } from "./lib/task-schema"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Database.node, TaskLedger.node, TaskExecution.node, CrossSpawnSpawner.node])),
)
it.live("coding execution verifies isolated edits and requests integration before completing durable ownership", () =>
  Effect.gen(function* () {
    yield* installTaskInteractionSchema
    const root = yield* tmpdirScoped({ git: true })
    const storage = yield* tmpdirScoped()
    const database = yield* Database.Service
    const tasks = yield* TaskExecution.Service
    const ledger = yield* TaskLedger.Service
    const owner = SessionID.make("ses_coding")
    const project = ProjectID.make("coding")
    yield* database.db.insert(ProjectTable).values({ id: project, worktree: AbsolutePath.make(root), sandboxes: [] })
    yield* database.db
      .insert(SessionTable)
      .values({ id: owner, project_id: project, directory: root, slug: "root", title: "Root", version: "test" })
    const authorization = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const driver = yield* TaskCodingDriver.make({
      engine: "v2",
      root: AbsolutePath.make(root),
      storage,
      open: (directory) =>
        Effect.succeed({
          engine: "v2",
          directory,
          run: (task) =>
            Effect.tryPromise(() => Bun.write(`${directory}/new.txt`, "Verified coding\n")).pipe(
              Effect.as({ summary: "Patch prepared", checks: [] }),
            ),
          cleanup: () => Effect.succeed("Native cleanup joined"),
        }),
      verify: (workspace, artifact) =>
        Effect.tryPromise(() => Bun.file(`${workspace.directory}/new.txt`).text()).pipe(
          Effect.map((output) => [
            {
              check: "Expected file",
              passed: output === "Verified coding\n",
              evidence: `Host read isolated file; patch ${artifact.digest}`,
            },
          ]),
        ),
      authorize: () => Deferred.succeed(authorization, undefined).pipe(Effect.andThen(Deferred.await(release))),
    })
    yield* tasks.register(driver)
    const baseRevision = yield* Effect.tryPromise(async () => {
      const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe" })
      const text = await new Response(child.stdout).text()
      if (await child.exited) throw new Error("Missing base")
      return text.trim()
    })
    const task = yield* tasks.dispatch({
      ownerSessionID: owner,
      dispatchKey: "one",
      brief: {
        title: "Code",
        objective: "Write file",
        scope: ["new.txt"],
        output: "Patch",
        checks: ["Expected file"],
        constraints: [],
        execution: {
          engine: "v2",
          mode: "coding",
          paths: ["new.txt"],
          baseRevision,
          agent: "worker",
          model: { id: "model", providerID: "test" },
          maxCalls: 2,
          wallClockMs: 10000,
        },
      },
    })
    yield* Deferred.await(authorization)
    expect((yield* ledger.get({ ownerSessionID: owner, taskID: task.id })).status).toBe("verifying")
    expect(yield* Effect.tryPromise(() => Bun.file(`${root}/new.txt`).exists())).toBe(false)
    yield* Deferred.succeed(release, undefined)
    yield* tasks.idle(owner)
    expect(yield* tasks.error(owner)).toBeUndefined()
    expect((yield* ledger.get({ ownerSessionID: owner, taskID: task.id })).status).toBe("completed")
    expect(yield* Effect.tryPromise(() => Bun.file(`${root}/new.txt`).text())).toBe("Verified coding\n")
  }),
)

it.live("cancelled coding authorization cannot integrate its retained patch", () =>
  Effect.gen(function* () {
    yield* installTaskInteractionSchema
    const root = yield* tmpdirScoped({ git: true })
    const storage = yield* tmpdirScoped()
    const database = yield* Database.Service
    const tasks = yield* TaskExecution.Service
    const ledger = yield* TaskLedger.Service
    const owner = SessionID.make("ses_cancel_coding")
    const project = ProjectID.make("cancel_coding")
    yield* database.db.insert(ProjectTable).values({ id: project, worktree: AbsolutePath.make(root), sandboxes: [] })
    yield* database.db
      .insert(SessionTable)
      .values({ id: owner, project_id: project, directory: root, slug: "root", title: "Root", version: "test" })
    const authorization = yield* Deferred.make<void>()
    const driver = yield* TaskCodingDriver.make({
      engine: "v2",
      root: AbsolutePath.make(root),
      storage,
      open: (directory) =>
        Effect.succeed({
          engine: "v2",
          directory,
          run: () =>
            Effect.tryPromise(() => Bun.write(`${directory}/new.txt`, "Cancelled\n")).pipe(
              Effect.as({ summary: "Patch", checks: [] }),
            ),
          cleanup: () => Effect.succeed("Native cleanup joined"),
        }),
      verify: () => Effect.succeed([{ check: "File", passed: true, evidence: "Host verified isolated patch" }]),
      authorize: () => Deferred.succeed(authorization, undefined).pipe(Effect.andThen(Effect.never)),
    })
    yield* tasks.register(driver)
    const baseRevision = yield* Effect.tryPromise(async () => {
      const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe" })
      const text = await new Response(child.stdout).text()
      if (await child.exited) throw new Error("Missing base")
      return text.trim()
    })
    const task = yield* tasks.dispatch({
      ownerSessionID: owner,
      dispatchKey: "one",
      brief: {
        title: "Code",
        objective: "Write file",
        scope: ["new.txt"],
        output: "Patch",
        checks: ["File"],
        constraints: [],
        execution: {
          engine: "v2",
          mode: "coding",
          paths: ["new.txt"],
          baseRevision,
          agent: "worker",
          model: { id: "model", providerID: "test" },
          maxCalls: 2,
          wallClockMs: 10000,
        },
      },
    })
    yield* Deferred.await(authorization)
    yield* tasks.cancel({ ownerSessionID: owner, taskID: task.id })
    yield* tasks.idle(owner)
    expect((yield* ledger.get({ ownerSessionID: owner, taskID: task.id })).status).toBe("cancelled")
    expect(yield* Effect.tryPromise(() => Bun.file(`${root}/new.txt`).exists())).toBe(false)
  }),
)
