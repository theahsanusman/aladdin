import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { TaskLedger } from "@opencode-ai/core/task/ledger"
import { SessionID } from "@opencode-ai/schema/session-id"

const filename = process.argv[2]
const owner = process.argv[3]
const epoch = process.argv[4]
if (!filename || !owner || !epoch) throw new Error("Expected database, owner, and runtime epoch")

const layer = AppNodeBuilder.build(LayerNode.group([Database.node, TaskLedger.node]), [
  [Database.node, makeGlobalNode({ service: Database.Service, layer: Database.layerFromPath(filename), deps: [] })],
])

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const ledger = yield* TaskLedger.Service
    yield* Effect.promise(() => Bun.stdin.text())
    const brief = {
      title: "Concurrent admission",
      objective: "Prove database ownership across processes",
      scope: ["The owning project"],
      output: "Verification evidence",
      checks: ["No duplicate claim or fourth slot"],
      constraints: [],
    }
    const task = yield* ledger.admit({ ownerSessionID: SessionID.make(owner), dispatchKey: "shared", brief })
    yield* ledger.admit({ ownerSessionID: SessionID.make(owner), dispatchKey: epoch, brief })
    const attempts = yield* Effect.forEach([1, 2, 3, 4], () =>
      ledger.claim({ ownerSessionID: SessionID.make(owner), runtimeEpoch: epoch }),
    )
    return { taskID: task.id, attempts: attempts.filter((attempt) => attempt !== undefined) }
  }).pipe(Effect.provide(layer), Effect.scoped),
)
process.stdout.write(JSON.stringify(result))
