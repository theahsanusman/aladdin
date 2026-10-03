import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Task } from "@opencode-ai/schema/task"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskInspectV1 } from "../src/task/inspect-v1"
import { MessageID } from "../src/session/schema"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Truncate } from "@/tool/truncate"
import { TestConfig } from "./fixture/config"
import { testEffect } from "./lib/effect"

// Truncate and Agent are part of every tool's execute path, so the leaf can only
// run against a layer that resolves them like the real registry does.
const it = testEffect(
  LayerNode.compile(LayerNode.group([Database.node, TaskLedger.node, EventV2.node, Truncate.node, Agent.node]), [
    [
      Config.node,
      TestConfig.layer({
        directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
      }),
    ],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

const project = ProjectID.make("inspect_project")
const owner = SessionID.make("ses_inspect_owner")
const child = SessionID.make("ses_inspect_child")
const brief = {
  title: "Audit",
  objective: "Read the homepage and report findings",
  scope: ["/inspect-app"],
  output: "A dated report",
  checks: ["output:nonempty"],
  constraints: ["Read-only"],
}

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({
    id: project,
    worktree: AbsolutePath.make("/inspect-app"),
    sandboxes: [],
  })
  yield* database.db.insert(SessionTable).values([
    { id: owner, project_id: project, directory: "/inspect-app", slug: "owner", title: "Owner", version: "test" },
    {
      id: child,
      parent_id: owner,
      project_id: project,
      directory: "/inspect-app",
      slug: "child",
      title: "Child",
      version: "test",
    },
  ])
})

const context = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "michael-lead",
  messages: [],
  abort: new AbortController().signal,
  ask: () => Effect.void,
  metadata: () => Effect.void,
})

describe("task_inspect", () => {
  it.instance("reports this chat's queue and one job's persisted evidence without waiting", () =>
    Effect.gen(function* () {
      yield* setup
      const ledger = yield* TaskLedger.Service
      const finished = yield* ledger.admit({
        ownerSessionID: owner,
        dispatchKey: "finished",
        brief: { ...brief, title: "Finished audit" },
      })
      const attempt = yield* ledger.claim({ ownerSessionID: owner, runtimeEpoch: "process-one" })
      if (!attempt) throw new Error("expected a claim")
      yield* ledger.transition(attempt, "running")
      yield* ledger.transition(attempt, "verifying")
      yield* ledger.settle(attempt, { outcome: "completed", evidence: "Report with three findings" })
      yield* ledger.admit({
        ownerSessionID: owner,
        dispatchKey: "pending",
        brief: { ...brief, title: "Pending audit" },
      })
      yield* ledger.setPaused(owner, true)

      const leaf = yield* TaskInspectV1.Tool
      const definition = yield* leaf.init()
      const board = JSON.parse((yield* definition.execute({}, context(owner))).output)
      expect(board.paused).toBe(true)
      expect(board.counts).toEqual({ completed: 1, queued: 1 })
      expect(board.tasks.map((task: { status: string }) => task.status)).toEqual(["queued", "completed"])
      expect(board.tasks.map((task: { id: string }) => task.id)).toContain(finished.id)
      expect(board.tasks[0]).toMatchObject({ id: board.tasks[0].id, title: "Pending audit" })

      const single = JSON.parse((yield* definition.execute({ taskID: finished.id }, context(owner))).output)
      expect(single.tasks).toHaveLength(1)
      expect(single.tasks[0]).toMatchObject({
        id: finished.id,
        title: "Finished audit",
        status: "completed",
        evidence: "Report with three findings",
        workerSessionID: attempt.workerSessionID,
      })
    }),
  )

  it.instance("never inspects another chat's queue", () =>
    Effect.gen(function* () {
      yield* setup
      yield* (yield* TaskLedger.Service).admit({ ownerSessionID: owner, dispatchKey: "owned", brief })
      const leaf = yield* TaskInspectV1.Tool
      const definition = yield* leaf.init()
      expect((yield* Effect.exit(definition.execute({}, context(child))))._tag).toBe("Failure")
      expect(
        (yield* Effect.exit(definition.execute({ taskID: Task.ID.make("tsk_missing01") }, context(owner))))._tag,
      ).toBe("Failure")
    }),
  )
})
