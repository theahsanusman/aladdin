import path from "node:path"
import { realpath, lstat, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { text } from "node:stream/consumers"
import process from "node:process"
import { Effect, Semaphore } from "effect"
import { TaskExecution } from "@opencode-ai/core/task/execution"
import { Process } from "../util/process"

export type Workspace = {
  readonly root: string
  readonly directory: string
  readonly base: string
  readonly repository: string
  readonly paths: readonly string[]
}
export type Artifact = { readonly patch: string; readonly digest: string; readonly files: readonly string[] }
const locks = new Map<string, Semaphore.Semaphore>()
const safe = (value: string) =>
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !value
    .split(/[\\/]/)
    .some(
      (part) =>
        part === ".." ||
        part === ".git" ||
        part === ".opencode" ||
        part === "opencode.json" ||
        part === "opencode.jsonc" ||
        part.startsWith(".env"),
    ) &&
  !value.includes("\0")

const filters = new Map<string, readonly string[]>()
const git = (directory: string, args: readonly string[], stdin?: string) =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () =>
        Process.spawn(
          [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "diff.external=",
            ...(filters.get(directory) ?? []),
            ...args,
          ],
          {
            cwd: directory,
            stdin: stdin === undefined ? "ignore" : "pipe",
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
        ),
      catch: (cause) => new TaskExecution.Error({ message: String(cause) }),
    }),
    (child) =>
      Effect.tryPromise({
        try: async () => {
          if (!child.stdout || !child.stderr) throw new Error("Workspace process output unavailable")
          if (stdin !== undefined) child.stdin?.end(stdin)
          const [stdout, stderr, exit] = await Promise.all([text(child.stdout), text(child.stderr), child.exited])
          if (exit !== 0) throw new Error(`git ${args[0]}: ${stderr.slice(0, 2000)}`)
          if (stdout.length > 10_000_000) throw new Error("Workspace artifact exceeds 10 MB")
          return stdout
        },
        catch: (cause) => new TaskExecution.Error({ message: String(cause) }),
      }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        await child.exited.catch(() => undefined)
      }),
  )

export const revision = (root: string) => git(root, ["rev-parse", "HEAD"]).pipe(Effect.map((value) => value.trim()))

export const create = Effect.fn("TaskWorkspace.create")(function* (input: {
  root: string
  storage: string
  attemptID: string
  paths: readonly string[]
  baseRevision?: string
}) {
  if (!/^tat_[a-zA-Z0-9_]+$/.test(input.attemptID) || !input.paths.length || !input.paths.every(safe))
    return yield* new TaskExecution.Error({ message: "Invalid immutable coding workspace scope" })
  const root = yield* Effect.tryPromise(() => realpath(input.root))
  const repository = (yield* git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim()
  const top = (yield* git(root, ["rev-parse", "--show-toplevel"])).trim()
  if (top !== root) return yield* new TaskExecution.Error({ message: "Coding requires the canonical repository root" })
  const base = (yield* git(root, ["rev-parse", "HEAD"])).trim()
  // A worktree checkout copies all tracked files before any tool policy runs.
  // Reject host/credential configuration rather than exposing it to a newly
  // bootstrapped worker Instance or trusting a model to avoid reading it.
  const tracked = (yield* git(root, ["ls-tree", "-r", "--name-only", "-z", base])).split("\0").filter(Boolean)
  if (
    tracked.some((file) =>
      /^(?:\.env(?:\..*)?|opencode\.jsonc?|auth\.json|credentials(?:\.json)?|.*\.(?:pem|key))$/i.test(
        path.basename(file),
      ),
    )
  ) {
    return yield* new TaskExecution.Error({
      message:
        "Coding workspace blocked: tracked host configuration or credential files require explicit isolation before checkout",
    })
  }
  const configuration = yield* git(root, ["config", "--name-only", "--list"])
  const overrides = [
    ...new Set(
      configuration
        .split("\n")
        .flatMap((key) => /^filter\.(.+)\.(clean|smudge|process|required)$/.exec(key)?.[1] ?? []),
    ),
  ].flatMap((name) =>
    ["clean", "smudge", "process", "required"].flatMap((operation) => [
      "-c",
      `filter.${name}.${operation}=${operation === "required" ? "false" : ""}`,
    ]),
  )
  filters.set(root, overrides)
  if (input.baseRevision && input.baseRevision !== base)
    return yield* new TaskExecution.Error({
      message: "Repository HEAD changed since coding admission; no automatic rebase",
    })
  const storage = yield* Effect.tryPromise(() => realpath(input.storage))
  if (storage === root || storage.startsWith(root + path.sep))
    return yield* new TaskExecution.Error({ message: "Workspace storage must not mutate the user's repository" })
  const directory = path.join(storage, input.attemptID)
  filters.set(directory, overrides)
  const exists = yield* Effect.tryPromise(() => lstat(directory)).pipe(Effect.option)
  if (exists._tag === "Some")
    return yield* new TaskExecution.Error({
      message: "Existing attempt workspace requires explicit reconciliation; never overwrite or replay",
    })
  yield* git(root, ["worktree", "add", "--detach", "--lock", directory, base])
  return { root, repository, directory, base, paths: input.paths } satisfies Workspace
})

export const capture = Effect.fn("TaskWorkspace.capture")(function* (workspace: Workspace) {
  const files = (yield* git(workspace.directory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
  if (
    files.some(
      (file) => !safe(file) || !workspace.paths.some((scope) => file === scope || file.startsWith(scope + "/")),
    )
  )
    return yield* new TaskExecution.Error({ message: "Workspace changed files outside accepted scope" })
  // Index belongs only to the detached worktree. Never stage the user's root.
  if (files.length) yield* git(workspace.directory, ["add", "--", ...files])
  const patch = yield* git(workspace.directory, [
    "diff",
    "--cached",
    "--binary",
    "--no-ext-diff",
    "--no-textconv",
    workspace.base,
    "--",
  ])
  const digest = createHash("sha256").update(patch).digest("hex")
  yield* Effect.tryPromise(() => writeFile(workspace.directory + ".patch", patch))
  return { patch, digest, files } satisfies Artifact
})

/** Caller must obtain native integration authorization and independently verify
 * the exact digest first. Dirty or changed roots block; no stash/reset/cleanup
 * of user edits. The repository lock is shared across all chats in this host. */
export const integrate = Effect.fn("TaskWorkspace.integrate")(function* (
  workspace: Workspace,
  artifact: Artifact,
  guard: Effect.Effect<void, unknown> = Effect.void,
  after: Effect.Effect<TaskExecution.Result["checks"], unknown> = Effect.succeed([]),
) {
  if (createHash("sha256").update(artifact.patch).digest("hex") !== artifact.digest)
    return yield* new TaskExecution.Error({ message: "Artifact digest changed after verification" })
  const paths = (yield* git(workspace.root, ["apply", "--numstat", "-z", "-"], artifact.patch))
    .split("\0")
    .filter(Boolean)
    .map((row) => row.split("\t").slice(2).join("\t"))
  if (
    paths.some(
      (file) => !safe(file) || !workspace.paths.some((scope) => file === scope || file.startsWith(scope + "/")),
    ) ||
    paths.length !== artifact.files.length ||
    paths.some((file) => !artifact.files.includes(file))
  )
    return yield* new TaskExecution.Error({ message: "Artifact patch targets paths outside accepted coding scope" })
  const lock = locks.get(workspace.repository) ?? Semaphore.makeUnsafe(1)
  locks.set(workspace.repository, lock)
  return yield* lock.withPermit(
    Effect.gen(function* () {
      if (
        (yield* git(workspace.root, ["rev-parse", "HEAD"])).trim() !== workspace.base ||
        (yield* git(workspace.root, ["status", "--porcelain=v1", "--untracked-files=all"])).trim()
      )
        return yield* new TaskExecution.Error({
          message: "Integration blocked: root changed or contains user edits; isolated patch retained",
        })
      if (artifact.patch.trim()) {
        yield* git(workspace.root, ["apply", "--check", "--binary", "-"], artifact.patch)
        yield* guard
        yield* git(workspace.root, ["apply", "--binary", "-"], artifact.patch)
      }
      return yield* after
    }),
  )
})

export * as TaskWorkspace from "./workspace"
