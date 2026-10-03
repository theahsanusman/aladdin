import { expect, test } from "bun:test"
import { Effect } from "effect"
import { TaskWorkspace } from "../src/task/workspace"
import { tmpdir } from "./fixture/fixture"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { which } from "@opencode-ai/core/util/which"
import { Process } from "../src/util/process"

test("Node coding admission captures and integrates a scoped artifact without Bun globals", async () => {
  await using root = await tmpdir({ git: true })
  await using storage = await tmpdir()
  const node = which("node")
  if (!node) throw new Error("Node is required for the desktop coding runtime regression")
  const bundle = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "fixture/task-workspace-node.ts")],
    target: "node",
    format: "esm",
  })
  expect(bundle.success).toBe(true)
  const entry = path.join(storage.path, "workspace.mjs")
  await Bun.write(entry, bundle.outputs[0])
  const result = await Process.run(
    [
      node,
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict"
      import { readFile, writeFile } from "node:fs/promises"
      import { createHash } from "node:crypto"
      import { Effect, TaskWorkspace } from ${JSON.stringify(pathToFileURL(entry).href)}
      assert.equal(typeof Bun, "undefined")
      const root = ${JSON.stringify(root.path)}
      const storage = ${JSON.stringify(storage.path)}
      const base = await Effect.runPromise(TaskWorkspace.revision(root))
      assert.match(base, /^[a-f0-9]{40,64}$/)
      const workspace = await Effect.runPromise(TaskWorkspace.create({
        root, storage, attemptID: "tat_node", paths: ["new.txt"], baseRevision: base,
      }))
      await writeFile(workspace.directory + "/new.txt", "node worker result\\n")
      const artifact = await Effect.runPromise(TaskWorkspace.capture(workspace))
      assert.deepEqual(artifact.files, ["new.txt"])
      assert.match(artifact.patch, /node worker result/)
      assert.equal(artifact.digest, createHash("sha256").update(artifact.patch).digest("hex"))
      assert.equal(await readFile(workspace.directory + ".patch", "utf8"), artifact.patch)
      const changed = await Effect.runPromise(Effect.exit(TaskWorkspace.integrate(workspace, { ...artifact, digest: "wrong" })))
      assert.equal(changed._tag, "Failure")
      await Effect.runPromise(TaskWorkspace.integrate(workspace, artifact))
      assert.equal(await readFile(root + "/new.txt", "utf8"), "node worker result\\n")
      const dirty = await Effect.runPromise(TaskWorkspace.create({
        root, storage, attemptID: "tat_node_dirty", paths: ["other.txt"], baseRevision: base,
      }))
      await writeFile(dirty.directory + "/other.txt", "isolated change\\n")
      const retained = await Effect.runPromise(TaskWorkspace.capture(dirty))
      assert.equal((await Effect.runPromise(Effect.exit(TaskWorkspace.integrate(dirty, retained))))._tag, "Failure")
      assert.equal(await readFile(root + "/new.txt", "utf8"), "node worker result\\n")
      console.log("NODE_CODING_SCOPE_VERIFIED")
    `,
    ],
    { nothrow: true },
  )
  expect(result.stderr.toString()).toBe("")
  expect(result.code).toBe(0)
  expect(result.stdout.toString()).toContain("NODE_CODING_SCOPE_VERIFIED")
}, 30_000)

test("isolated coding workspace preserves dirty root and refuses integration without clearing user edits", async () => {
  await using root = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(`${dir}/source.txt`, "base\n")
      const add = Bun.spawn(["git", "add", "source.txt"], { cwd: dir })
      expect(await add.exited).toBe(0)
      const commit = Bun.spawn(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"],
        { cwd: dir },
      )
      expect(await commit.exited).toBe(0)
    },
  })
  await using storage = await tmpdir()
  await Bun.write(`${root.path}/source.txt`, "user edit\n")
  const workspace = await Effect.runPromise(
    TaskWorkspace.create({ root: root.path, storage: storage.path, attemptID: "tat_test", paths: ["source.txt"] }),
  )
  expect(await Bun.file(`${workspace.directory}/source.txt`).text()).toBe("base\n")
  await Bun.write(`${workspace.directory}/source.txt`, "worker edit\n")
  const artifact = await Effect.runPromise(TaskWorkspace.capture(workspace))
  expect(artifact.patch).toContain("worker edit")
  expect(await Effect.runPromise(Effect.exit(TaskWorkspace.integrate(workspace, artifact)))).toMatchObject({
    _tag: "Failure",
  })
  expect(await Bun.file(`${root.path}/source.txt`).text()).toBe("user edit\n")
})

test("integration applies a verified scoped patch only to a clean unchanged root", async () => {
  await using root = await tmpdir({ git: true })
  await using storage = await tmpdir()
  const workspace = await Effect.runPromise(
    TaskWorkspace.create({ root: root.path, storage: storage.path, attemptID: "tat_integrate", paths: ["new.txt"] }),
  )
  await Bun.write(`${workspace.directory}/new.txt`, "new\n")
  const artifact = await Effect.runPromise(TaskWorkspace.capture(workspace))
  await Effect.runPromise(TaskWorkspace.integrate(workspace, artifact))
  expect(await Bun.file(`${root.path}/new.txt`).text()).toBe("new\n")
})

test("integration rejects a self-consistent artifact targeting files outside immutable coding paths", async () => {
  await using root = await tmpdir({ git: true })
  await using storage = await tmpdir()
  const workspace = await Effect.runPromise(
    TaskWorkspace.create({ root: root.path, storage: storage.path, attemptID: "tat_forged", paths: ["allowed.txt"] }),
  )
  const patch =
    "diff --git a/outside.txt b/outside.txt\nnew file mode 100644\nindex 0000000..3e75765\n--- /dev/null\n+++ b/outside.txt\n@@ -0,0 +1 @@\n+new\n"
  const artifact = { patch, digest: new Bun.CryptoHasher("sha256").update(patch).digest("hex"), files: ["outside.txt"] }
  expect(await Effect.runPromise(Effect.exit(TaskWorkspace.integrate(workspace, artifact)))).toMatchObject({
    _tag: "Failure",
  })
  expect(await Bun.file(`${root.path}/outside.txt`).exists()).toBe(false)
})

test("coding refuses to copy tracked credential files or inline repository API keys", async () => {
  await using root = await tmpdir({
    git: true,
    init: async (directory) => {
      await Bun.write(
        `${directory}/opencode.json`,
        JSON.stringify({ provider: { custom: { options: { apiKey: "private-test-key" } } } }),
      )
      const add = Bun.spawn(["git", "add", "opencode.json"], { cwd: directory })
      expect(await add.exited).toBe(0)
      const commit = Bun.spawn(["git", "commit", "-m", "fixture"], { cwd: directory })
      expect(await commit.exited).toBe(0)
    },
  })
  await using storage = await tmpdir()
  expect(
    await Effect.runPromise(
      Effect.exit(
        TaskWorkspace.create({
          root: root.path,
          storage: storage.path,
          attemptID: "tat_secret",
          paths: ["source.txt"],
        }),
      ),
    ),
  ).toMatchObject({ _tag: "Failure" })
  expect(await Bun.file(`${storage.path}/tat_secret/opencode.json`).exists()).toBe(false)
})
