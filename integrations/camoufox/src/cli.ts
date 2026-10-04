import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { isAbsolute } from "node:path"
import { dirname, join } from "node:path"
import { lstat, open, readFile, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { BrowserManager } from "./browser.ts"
import { publicError } from "./contracts.ts"
import { browserEnvironment, profileName, secureDirectory } from "./profiles.ts"
import { requestBroker, startBroker } from "./service.ts"

async function main() {
  process.umask(0o077)
  const args = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      executable: { type: "string" },
      profile: { type: "string", default: "default" },
      config: { type: "string" },
    },
  })
  const root = args.values.root
  const executable = args.values.executable
  if (!root || !executable || !isAbsolute(root) || !isAbsolute(executable))
    throw new Error("Pass absolute --root and --executable paths")
  await secureDirectory(root)
  const entry = fileURLToPath(import.meta.url)
  const profile = profileName(args.values.profile!)
  if (args.positionals[0] === "configure") {
    const path = args.values.config
    if (!path || !isAbsolute(path)) throw new Error("Pass an absolute JSON config file path")
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.())
      throw new Error("Configuration must be an owned regular file")
    const original = await readFile(path, "utf8")
    const { configuration } = await import("./configuration.ts")
    const updated = configuration(JSON.parse(original) as Record<string, unknown>, [
      process.execPath,
      entry,
      "mcp",
      "--root",
      root,
      "--executable",
      executable,
    ])
    const backups = join(root, "config-backups")
    await secureDirectory(backups)
    const backup = join(backups, `opencode-before-camoufox-${Date.now()}.json`)
    const handle = await open(
      backup,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await handle.writeFile(original)
      await handle.sync()
    } finally {
      await handle.close()
    }
    const temporary = join(dirname(path), `.camoufox-config-${randomUUID()}.json`)
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(JSON.stringify(updated, null, 2) + "\n")
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      if ((await readFile(path, "utf8")) !== original) throw new Error("Configuration changed during installation")
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
    process.stdout.write(
      JSON.stringify({
        configured: true,
        backup,
        chromeToolsAvailable: updated.mcp["chrome-devtools"]?.enabled === true,
        camoufoxEnabled: true,
        permission: "camoufox_*:allow",
      }) + "\n",
    )
    return
  }
  if (args.positionals[0] === "broker") {
    const broker = await startBroker(root, new BrowserManager({ root, executable }))
    process.once("SIGTERM", () => {
      void broker.close()
    })
    process.once("SIGINT", () => {
      void broker.close()
    })
    return
  }
  if (args.positionals[0] === "stop") {
    await requestBroker(root, { control: "stop" })
    return
  }
  const invoke = async (request: unknown) => {
    const available = await requestBroker(root, { action: "profiles", operation: "list" })
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ECONNREFUSED") return false
        throw error
      })
    if (!available) {
      const child = spawn(process.execPath, [entry, "broker", "--root", root, "--executable", executable], {
        detached: true,
        stdio: "ignore",
        env: browserEnvironment(process.env),
      })
      child.unref()
      const deadline = Date.now() + 10000
      let ready = false
      while (!ready && Date.now() < deadline) {
        ready = await requestBroker(root, { action: "profiles", operation: "list" })
          .then(() => true)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT" || error.code === "ECONNREFUSED") return false
            throw error
          })
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (!ready) throw new Error("The private browser service did not start")
    }
    return requestBroker(root, request)
  }
  if (args.positionals[0] === "mcp") {
    const { runMcp } = await import("./mcp.ts")
    await runMcp(invoke)
    return
  }
  if (args.positionals[0] === "open" || args.positionals[0] === "close") {
    const value = await invoke({ action: "profiles", operation: args.positionals[0], profile })
    process.stdout.write(JSON.stringify(value) + "\n")
    return
  }
  if (args.positionals[0] === "profiles") {
    process.stdout.write(JSON.stringify(await invoke({ action: "profiles", operation: "list" })) + "\n")
    return
  }
  throw new Error("Use mcp, broker, open, close, profiles, stop or configure")
}

await main().catch((error: unknown) => {
  process.stderr.write(publicError(error) + "\n")
  process.exitCode = 1
})
