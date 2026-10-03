import { expect, test } from "bun:test"
import { spawn } from "bun-pty"

const unix = process.platform === "win32" ? test.skip : test

unix(
  "Bun PTY preserves output and the real exit code of a short command",
  async () => {
    for (let index = 0; index < 20; index++) {
      const proc = spawn("/usr/bin/env", ["sh", "-c", "printf fast-output; exit 7"], { name: "xterm", cwd: "/tmp" })
      let output = ""
      proc.onData((data) => {
        output += data
      })
      try {
        const exit = await new Promise<{ exitCode: number }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Short PTY command did not report its exit")), 2_000)
          proc.onExit((event) => {
            clearTimeout(timeout)
            resolve(event)
          })
        })
        expect(output).toBe("fast-output")
        expect(exit.exitCode).toBe(7)
        const replayed = await new Promise<{ exitCode: number }>((resolve) => proc.onExit(resolve))
        expect(replayed.exitCode).toBe(7)
        let disposedCalls = 0
        const subscription = proc.onExit(() => {
          disposedCalls++
        })
        subscription.dispose()
        await Promise.resolve()
        expect(disposedCalls).toBe(0)
      } finally {
        proc.kill()
      }
    }
  },
  30_000,
)
