import { describe, expect } from "bun:test"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect, Layer } from "effect"
import { Verification } from "@/automation/verification"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function tempdir(init?: (directory: string) => Promise<void>) {
  return Effect.gen(function* () {
    const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-verify-")))
    yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })))
    if (init) yield* Effect.promise(() => init(directory))
    return directory
  })
}

describe("verification runner", () => {
  it.live("passes when every check exits zero", () =>
    Effect.gen(function* () {
      const directory = yield* tempdir()
      const report = yield* Verification.run({
        directory,
        checks: [{ command: "echo hello" }, { command: "exit 0" }],
      })
      expect(report.passed).toBe(true)
      expect(report.results.map((result) => result.exitCode)).toEqual([0, 0])
      expect(Verification.evidence(report)).toContain("$ echo hello (exit 0")
    }),
  )

  it.live("fails and records output when a check exits non-zero", () =>
    Effect.gen(function* () {
      const directory = yield* tempdir()
      const report = yield* Verification.run({
        directory,
        checks: [{ command: "echo problem >&2; exit 3" }],
      })
      expect(report.passed).toBe(false)
      expect(report.results[0]).toMatchObject({ command: "echo problem >&2; exit 3", exitCode: 3, timedOut: false })
      expect(report.results[0].output).toContain("problem")
    }),
  )

  it.live("kills checks that exceed their timeout", () =>
    Effect.gen(function* () {
      const directory = yield* tempdir()
      const report = yield* Verification.run({
        directory,
        checks: [{ command: "sleep 5", timeoutSeconds: 1 }],
      })
      expect(report.passed).toBe(false)
      expect(report.results[0]).toMatchObject({ exitCode: 124, timedOut: true })
      expect(Verification.evidence(report)).toContain("timed out")
    }),
  )

  it.live("does not report a command that finishes before its deadline as timed out", () =>
    Effect.gen(function* () {
      const directory = yield* tempdir()
      // Long timeout, fast command: the timer is cleared on completion, so the
      // result must be a normal exit rather than a timeout.
      const report = yield* Verification.run({
        directory,
        checks: [{ command: "echo done", timeoutSeconds: 30 }],
      })
      expect(report.passed).toBe(true)
      expect(report.results[0]).toMatchObject({ exitCode: 0, timedOut: false, output: "done" })
    }),
  )

  it.live("terminates a descendant process when the check times out", () =>
    Effect.gen(function* () {
      const directory = yield* tempdir()
      const report = yield* Verification.run({
        directory,
        // A background child retains the shell's output pipes after SIGTERM.
        // The check must stop the entire process group at the deadline.
        checks: [{ command: "sleep 30 & wait", timeoutSeconds: 1 }],
      })
      expect(report.results[0]).toMatchObject({ exitCode: 124, timedOut: true })
      expect(report.results[0].durationMs).toBeLessThan(10_000)
    }),
  )

  it.live("runs checks in the project directory", () =>
    Effect.gen(function* () {
      const directory = yield* tempdir((dir) => fs.writeFile(path.join(dir, "marker.txt"), "ok").then(() => undefined))
      const report = yield* Verification.run({ directory, checks: [{ command: "cat marker.txt" }] })
      expect(report.passed).toBe(true)
      expect(report.results[0].output).toBe("ok")
    }),
  )
})
