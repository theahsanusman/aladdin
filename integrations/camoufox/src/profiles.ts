import { constants } from "node:fs"
import { lstat, mkdir, open, readdir } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { z } from "zod"

export const browserVersion = "156.0.1-beta.34"
const identitySchema = z
  .object({
    schema: z.literal(1),
    browser: z.literal(browserVersion),
    preset: z.record(z.string(), z.unknown()),
  })
  .strict()

export function profileName(name: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name)) throw new Error("Invalid profile name")
  return name
}

// Check ancestors as well: mkdir({ recursive: true }) alone follows symlinks.
export async function secureDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error("Browser storage must use an absolute path")
  const parts: string[] = []
  for (let current = resolve(path); current !== dirname(current); current = dirname(current)) parts.unshift(current)
  for (const part of parts) {
    const info = await lstat(part).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new Error("Browser storage cannot contain a symlink")
    if (info && !info.isDirectory()) throw new Error("Browser storage must be a directory")
  }
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
    throw new Error("Browser storage must be private to its owner")
}

export async function readPrivateJSON(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 2_000_000) {
      throw new Error("Browser metadata must be a private, bounded file")
    }
    return JSON.parse(await file.readFile("utf8")) as unknown
  } finally {
    await file.close()
  }
}

export class ProfileStore {
  constructor(readonly root: string) {}

  async initialize() {
    await secureDirectory(this.root)
    await secureDirectory(join(this.root, "profiles"))
  }

  async list() {
    await this.initialize()
    return (await readdir(join(this.root, "profiles"), { withFileTypes: true }))
      .filter((item) => item.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(item.name))
      .map((item) => item.name)
      .sort()
  }

  async ensure(name: string, generate: () => Record<string, unknown>) {
    await this.initialize()
    const directory = join(this.root, "profiles", profileName(name))
    await secureDirectory(directory)
    await secureDirectory(join(directory, "browser"))
    await secureDirectory(join(directory, "downloads"))
    await secureDirectory(join(directory, "uploads"))
    const identityPath = join(directory, "identity.json")
    const existing = await lstat(identityPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!existing) {
      const identity = identitySchema.parse({ schema: 1, browser: browserVersion, preset: generate() })
      const file = await open(identityPath, "wx", 0o600)
      try {
        await file.writeFile(JSON.stringify(identity) + "\n")
        await file.sync()
      } finally {
        await file.close()
      }
    }
    return { directory, identityPath, identity: identitySchema.parse(await readPrivateJSON(identityPath)).preset }
  }
}

export function browserEnvironment(source: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TZ",
      "DISPLAY",
      "XAUTHORITY",
      "WAYLAND_DISPLAY",
      "XDG_RUNTIME_DIR",
    ].flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]!]])),
  )
}
