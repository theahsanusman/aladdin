import { chmod, lstat, unlink } from "node:fs/promises"
import { connect, createServer, type Socket } from "node:net"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"
import { DatabaseSync } from "node:sqlite"
import { BrowserManager } from "./browser.ts"
import { BrowserError, publicError, requests } from "./contracts.ts"
import { secureDirectory } from "./profiles.ts"

const requestLimit = 700_000
const responseLimit = 16_000_000

async function socketInfo(root: string) {
  await secureDirectory(root)
  const info = await lstat(join(root, "control.sock")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (info && (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
    throw new BrowserError("protocol")
  return info
}

export async function requestBroker(root: string, input: unknown) {
  await socketInfo(root)
  const data = JSON.stringify(input) + "\n"
  if (Buffer.byteLength(data) > requestLimit) throw new BrowserError("protocol")
  return new Promise<unknown>((resolve, reject) => {
    const socket = connect(join(root, "control.sock"))
    const decoder = new StringDecoder("utf8")
    let buffer = ""
    let size = 0
    socket.setTimeout(65000, () => socket.destroy(new BrowserError("busy")))
    socket.on("connect", () => socket.write(data))
    socket.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > responseLimit) {
        socket.destroy(new BrowserError("protocol"))
        return
      }
      buffer += decoder.write(chunk)
      if (!buffer.includes("\n")) return
      try {
        const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n"))) as {
          ok: boolean
          value?: unknown
          error?: string
        }
        if (result.ok !== true) {
          reject(new Error("Private browser operation failed"))
          socket.destroy()
          return
        }
        resolve(result.value)
        socket.destroy()
      } catch {
        socket.destroy(new BrowserError("protocol"))
      }
    })
    socket.on("error", reject)
    socket.on("end", () => reject(new BrowserError("protocol")))
  })
}

export async function startBroker(root: string, manager: BrowserManager) {
  process.umask(0o077)
  const existing = await socketInfo(root)
  const lockPath = join(root, "broker.lock.sqlite")
  const info = await lstat(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (info && (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
    throw new BrowserError("protocol")
  // SQLite owns a kernel-backed file lock. A killed broker releases it, so
  // concurrent restarts cannot both remove a stale socket and own a profile.
  const lock = await acquireLock(lockPath)
  try {
    const path = join(root, "control.sock")
    if (existing) {
      const reachable = await new Promise<boolean>((resolve, reject) => {
        const socket = connect(path)
        socket.on("connect", () => {
          socket.destroy()
          resolve(true)
        })
        socket.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
            resolve(false)
            return
          }
          reject(error)
        })
        socket.setTimeout(2000, () => {
          socket.destroy()
          resolve(true)
        })
      })
      if (reachable) throw new BrowserError("busy")
      const current = await socketInfo(root)
      if (current?.ino !== existing.ino) throw new BrowserError("busy")
      await unlink(path)
    }
    const clients = new Set<Socket>()
    const state: { closing?: Promise<void> } = {}
    const close = () =>
      (state.closing ??= (async () => {
        clients.forEach((socket) => socket.destroy())
        const closed = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
        try {
          await manager.closeAll()
          await closed
        } finally {
          lock.close()
        }
      })())
    const server = createServer((socket) => {
      clients.add(socket)
      socket.on("close", () => clients.delete(socket))
      socket.on("error", () => undefined)
      socket.setTimeout(65000, () => socket.destroy())
      let buffer = ""
      let size = 0
      let admitted = false
      const decoder = new StringDecoder("utf8")
      socket.on("data", (chunk: Buffer) => {
        if (admitted) {
          socket.destroy()
          return
        }
        size += chunk.length
        if (size > requestLimit) {
          socket.destroy()
          return
        }
        buffer += decoder.write(chunk)
        if (!buffer.includes("\n")) return
        admitted = true
        void (async () => {
          try {
            const input: unknown = JSON.parse(buffer.slice(0, buffer.indexOf("\n")))
            if (buffer.slice(buffer.indexOf("\n") + 1).trim()) throw new BrowserError("protocol")
            if (
              typeof input === "object" &&
              input !== null &&
              "control" in input &&
              input.control === "stop" &&
              Object.keys(input).length === 1
            ) {
              socket.once("close", () => {
                void close()
              })
              socket.end(JSON.stringify({ ok: true, value: { stopped: true } }) + "\n")
              return
            }
            const value = await manager.execute(requests.parse(input))
            const output = JSON.stringify({ ok: true, value }) + "\n"
            if (Buffer.byteLength(output) > responseLimit) throw new BrowserError("protocol")
            socket.end(output)
          } catch (error) {
            socket.end(JSON.stringify({ ok: false, error: publicError(error) }) + "\n")
          }
        })()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(path, resolve)
    })
    await chmod(path, 0o600)
    return {
      close,
    }
  } catch (error) {
    lock.close()
    throw error
  }
}

async function acquireLock(path: string): Promise<DatabaseSync> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const lock = new DatabaseSync(path)
    try {
      lock.exec("BEGIN EXCLUSIVE")
      return lock
    } catch {
      // Two constructors can both briefly hold read locks while creating an
      // empty database. Release the connection before retrying acquisition.
      lock.close()
      await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 100)))
    }
  }
  throw new BrowserError("busy")
}
