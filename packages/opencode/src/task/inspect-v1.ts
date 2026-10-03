import { Effect, Schema } from "effect"
import { Task } from "@opencode-ai/schema/task"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { define, type Context } from "../tool/tool"

export const Parameters = Schema.Struct({ taskID: Schema.optional(Task.ID) })

/**
 * Read-only view of this chat's durable worker queue. It is deliberately named
 * `task_inspect`: upstream removed its polling `task_status` tool along with the
 * need for background agents to poll, and that guard stays in place. One call
 * returns the current state; there is no subscription or wait here.
 */
export const Tool = define(
  "task_inspect",
  Effect.gen(function* () {
    const ledger = yield* TaskLedger.Service
    return {
      description:
        "Read this chat's durable worker queue without waiting: it returns immediately and must never be used to poll or wait for a worker. Pass nothing for the queue with per-status counts and the paused flag, or pass taskID for exactly one job including its persisted evidence and worker session. Counts are per status: queued means waiting in FIFO order and says nothing about slot occupancy, while starting, running, waiting_for_user, verifying and cancelling occupy one of the three slots. Dismissed jobs are excluded, and results also arrive as durable result cards, so call this only when you actually need the current state.",
      parameters: Parameters,
      execute: Effect.fn("TaskInspectV1.execute")(function* (input: typeof Parameters.Type, context: Context) {
        const board = yield* ledger.board(context.sessionID)
        const single = input.taskID
          ? yield* ledger.details({ ownerSessionID: context.sessionID, taskID: input.taskID })
          : undefined
        const tasks = (single ? [single] : board.data).map((entry) => ({
          id: entry.task.id,
          title: entry.task.brief.title,
          status: entry.task.status,
          generation: entry.task.generation,
          queueSequence: entry.task.queueSequence,
          timeUpdated: entry.task.timeUpdated,
          ...(entry.attempt ? { workerSessionID: entry.attempt.workerSessionID } : {}),
          // Evidence stays out of the queue view: one report can swallow the whole
          // tool output, and result cards already deliver it durably.
          ...(single && entry.evidence !== undefined ? { evidence: entry.evidence } : {}),
        }))
        return {
          title: single?.task.brief.title ?? "Worker queue",
          metadata: { paused: board.team.paused, tasks: tasks.length },
          output: JSON.stringify({ paused: board.team.paused, counts: board.counts, tasks }),
        }
      }, Effect.orDie),
    }
  }),
)

export * as TaskInspectV1 from "./inspect-v1"
