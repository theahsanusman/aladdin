import { Automation } from "@opencode-ai/schema/automation"
import { Effect } from "effect"
import { spawn } from "node:child_process"
import { buffer } from "node:stream/consumers"

export interface CheckResult {
  command: string
  exitCode: number
  output: string
  durationMs: number
  timedOut: boolean
}

export interface Report {
  passed: boolean
  results: CheckResult[]
}

const MAX_OUTPUT = 2000
const DEFAULT_TIMEOUT_SECONDS = 120

export function run(input: { directory: string; checks: ReadonlyArray<Automation.Check> }): Effect.Effect<Report> {
  return Effect.forEach(
    input.checks,
    (check) =>
      Effect.promise(async (): Promise<CheckResult> => {
        const started = Date.now()
        const seconds = check.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
        let timedOut = false
        // An isolated process group lets a deadline terminate background children
        // which otherwise keep the shell's stdout/stderr pipes open indefinitely.
        const child = spawn("sh", ["-c", check.command], {
          cwd: input.directory,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        })
        const exited = new Promise<number>((resolve, reject) => {
          child.once("error", reject)
          child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
        })
        const stop = () => {
          if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
          if (process.platform === "win32") {
            child.kill()
            return
          }
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
          }
        }
        const timer = setTimeout(() => {
          timedOut = true
          stop()
        }, seconds * 1000)
        try {
          const [code, stdout, stderr] = await Promise.all([exited, buffer(child.stdout), buffer(child.stderr)])
          const combined = [stdout.toString(), stderr.toString()]
            .filter(Boolean)
            .join("\n")
            .trim()
          const output = timedOut ? `${combined}\n[timed out after ${seconds}s]`.trim() : combined
          return {
            command: check.command,
            exitCode: timedOut ? 124 : code,
            output: output.slice(-MAX_OUTPUT),
            durationMs: Date.now() - started,
            timedOut,
          }
        } catch (error) {
          return {
            command: check.command,
            exitCode: 1,
            output: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - started,
            timedOut,
          }
        } finally {
          clearTimeout(timer)
          if (timedOut) stop()
        }
      }),
    { concurrency: 1 },
  ).pipe(Effect.map((results) => ({ passed: results.every((result) => result.exitCode === 0), results })))
}

export function evidence(report: Report) {
  return report.results
    .map((result) => {
      const header = `$ ${result.command} (exit ${result.exitCode}, ${(result.durationMs / 1000).toFixed(1)}s${result.timedOut ? ", timed out" : ""})`
      return result.output ? `${header}\n${result.output}` : header
    })
    .join("\n\n")
    .slice(0, 8000)
}

export * as Verification from "./verification"
