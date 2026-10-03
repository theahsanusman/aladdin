export * as TaskWorkerPolicy from "./worker-policy"

import path from "node:path"
import { Effect, FileSystem } from "effect"
import { Task } from "@opencode-ai/schema/task"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { TaskExecution } from "./execution"

const orchestration = ["task", "task_dispatch", "plan_enter", "plan_exit"]

export function names(policy: Task.Execution, available: readonly string[] = []) {
  if (policy.mode === "native")
    return policy.agent === "michael" ? available.filter((name) => !orchestration.includes(name)) : []
  const discipline = policy.agent === "michael" ? ["skill", "websearch", "webfetch"] : []
  if (policy.mode === "report") return discipline
  return [...discipline, "read", "glob", "grep", "question", ...(policy.mode === "coding" ? ["edit", "write"] : [])]
}

const contains = (root: string, target: string) => target === root || target.startsWith(root + path.sep)
export const searchExclusions = [
  "**/.opencode/**",
  "**/opencode.json",
  "**/opencode.jsonc",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/auth.json",
  "**/credentials",
  "**/credentials.json",
  "**/id_rsa",
  "**/id_ed25519",
] as const
const sensitive = (relative: string) =>
  relative
    .split(path.sep)
    .some(
      (part) =>
        part === ".git" ||
        part === ".env" ||
        part.startsWith(".env.") ||
        part === ".opencode" ||
        part === "opencode.json" ||
        part === "opencode.jsonc" ||
        /^(?:auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519|.*\.(?:pem|key))$/i.test(part),
    )

/** Restrict calls before forwarding to existing native leaves. Those leaves
 * remain responsible for permission requests and revalidation at mutation time.
 * Restricted modes exclude shell and MCP. Native Michael uses those tools with
 * their ordinary permissions; a working directory is not a shell sandbox.
 * Recursive delegation is excluded in every mode. */
export const assert = Effect.fn("TaskWorkerPolicy.assert")(function* (
  policy: Task.Execution,
  root: AbsolutePath,
  name: string,
  input: unknown,
) {
  // Native mode is the user's ordinary Michael agent, with native permission
  // checks and tools. It deliberately makes no worktree/shell sandbox claim.
  if (policy.mode === "native") {
    if (policy.agent !== "michael" || orchestration.includes(name))
      return yield* new TaskExecution.Error({ message: `Native Michael worker cannot execute: ${name}` })
    return
  }
  if (!names(policy).includes(name))
    return yield* new TaskExecution.Error({ message: `Worker tool is outside immutable mode: ${name}` })
  if (["question", "skill", "websearch", "webfetch"].includes(name)) return
  if (!input || typeof input !== "object")
    return yield* new TaskExecution.Error({ message: "Invalid worker tool input" })
  const requested = "filePath" in input ? input.filePath : "path" in input ? input.path : "."
  if (typeof requested !== "string") return yield* new TaskExecution.Error({ message: "Invalid worker tool path" })
  const fs = yield* FileSystem.FileSystem
  const canonical = yield* fs.realPath(root)
  const target = path.resolve(canonical, requested)
  const relative = path.relative(canonical, target)
  if (!contains(canonical, target) || sensitive(relative))
    return yield* new TaskExecution.Error({
      message: "Worker path escapes immutable scope or targets protected configuration",
    })
  // Inspect every existing component, including symlinked directories. New
  // files inherit validation from their nearest existing parent.
  yield* Effect.forEach(relative.split(path.sep).filter(Boolean), (_, index) =>
    Effect.gen(function* () {
      const prefix = path.join(canonical, ...relative.split(path.sep).slice(0, index + 1))
      const link = yield* fs.readLink(prefix).pipe(Effect.option)
      if (link._tag === "Some")
        return yield* new TaskExecution.Error({
          message: "Worker paths may not traverse symbolic links, including dangling links",
        })
      const resolved = yield* fs
        .realPath(prefix)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(prefix)))
      if (!contains(canonical, resolved) || sensitive(path.relative(canonical, resolved)))
        return yield* new TaskExecution.Error({ message: "Worker symlink escapes immutable scope" })
    }),
  )
  if (name !== "edit" && name !== "write") return
  if (
    !policy.paths?.length ||
    policy.paths.some((item) => path.isAbsolute(item) || item.split(/[\\/]/).includes("..") || sensitive(item))
  )
    return yield* new TaskExecution.Error({ message: "Coding requires explicit safe relative mutation paths" })
  if (!policy.paths.some((item) => contains(path.resolve(canonical, item), target)))
    return yield* new TaskExecution.Error({ message: "Mutation is outside the accepted task paths" })
})
