import { expect } from "bun:test"
import { Effect, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { TaskWorkerPolicy } from "../src/task/worker-policy"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const it = testEffect(NodeFileSystem.layer)
const policy = {
  engine: "v2" as const,
  agent: "worker",
  model: { id: "model", providerID: "provider" },
  mode: "research" as const,
  maxCalls: 10,
  wallClockMs: 1000,
}
it.live("native Michael workers retain shell and installed MCP tools while denying recursive orchestration", () =>
  Effect.gen(function* () {
    const worker = { ...policy, agent: "michael", mode: "native" as const }
    const available = ["skill", "bash", "chrome-devtools_new_page", "edit", "task", "task_dispatch", "plan_enter"]
    expect(TaskWorkerPolicy.names(worker, available)).toEqual(["skill", "bash", "chrome-devtools_new_page", "edit"])
    for (const name of ["bash", "chrome-devtools_new_page", "external_directory"])
      yield* TaskWorkerPolicy.assert(worker, AbsolutePath.make("/worker"), name, {})
    for (const name of ["task", "task_dispatch", "plan_enter", "plan_exit"])
      expect(yield* Effect.exit(TaskWorkerPolicy.assert(worker, AbsolutePath.make("/worker"), name, {}))).toMatchObject(
        { _tag: "Failure" },
      )
    expect(
      yield* Effect.exit(
        TaskWorkerPolicy.assert({ ...worker, agent: "build" }, AbsolutePath.make("/worker"), "bash", {}),
      ),
    ).toMatchObject({ _tag: "Failure" })
  }),
)
it.live(
  "research allows native read/search/question but rejects mutation, recursion, external paths and symlink escape",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const root = AbsolutePath.make(tmp.path)
      yield* fs.writeFileString(`${root}/facts.txt`, "Facts")
      yield* fs.symlink("/etc", `${root}/escape`)
      yield* fs.symlink(`${root}/missing-target`, `${root}/dangling`)
      expect(TaskWorkerPolicy.names(policy)).toEqual(["read", "glob", "grep", "question"])
      yield* TaskWorkerPolicy.assert(policy, root, "read", { path: "facts.txt" })
      yield* TaskWorkerPolicy.assert(policy, root, "question", { questions: [] })
      for (const [name, input] of [
        ["write", { path: "facts.txt" }],
        ["task_dispatch", {}],
        ["read", { path: "../secret" }],
        ["read", { path: "escape/passwd" }],
        ["glob", { path: "escape" }],
        ["read", { path: ".git/config" }],
      ] as const)
        expect(yield* Effect.exit(TaskWorkerPolicy.assert(policy, root, name, input))).toMatchObject({
          _tag: "Failure",
        })
      expect(
        yield* Effect.exit(
          TaskWorkerPolicy.assert({ ...policy, mode: "coding", paths: ["dangling"] }, root, "write", {
            path: "dangling",
          }),
        ),
      ).toMatchObject({ _tag: "Failure" })
    }),
)
it.live("coding mutation is constrained to immutable relative paths and never enables unrestricted shell", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const root = AbsolutePath.make(tmp.path)
    const coding = { ...policy, mode: "coding" as const, paths: ["src"] }
    yield* TaskWorkerPolicy.assert(coding, root, "write", { filePath: `${root}/src/new.ts` })
    expect(yield* Effect.exit(TaskWorkerPolicy.assert(coding, root, "edit", { path: "package.json" }))).toMatchObject({
      _tag: "Failure",
    })
    expect(
      yield* Effect.exit(TaskWorkerPolicy.assert(coding, root, "bash", { command: "touch ../root" })),
    ).toMatchObject({ _tag: "Failure" })
    expect(yield* Effect.exit(TaskWorkerPolicy.assert(coding, root, "write", { path: "src/.env" }))).toMatchObject({
      _tag: "Failure",
    })
  }),
)

it.live("Michael workers can load skills and research even in report mode without enabling recursion or shell", () =>
  Effect.gen(function* () {
    const worker = { ...policy, agent: "michael", mode: "report" as const }
    const root = AbsolutePath.make("/worker")
    for (const [name, input] of [
      ["skill", { name: "unlazy" }],
      ["websearch", { query: "current docs" }],
      ["webfetch", { url: "https://example.com" }],
    ] as const) {
      expect(TaskWorkerPolicy.names(worker)).toContain(name)
      yield* TaskWorkerPolicy.assert(worker, root, name, input)
    }
    for (const name of ["bash", "task", "task_dispatch", "write"]) {
      expect(yield* Effect.exit(TaskWorkerPolicy.assert(worker, root, name, {}))).toMatchObject({ _tag: "Failure" })
    }
  }),
)
