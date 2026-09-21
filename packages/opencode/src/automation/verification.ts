import { Automation } from "@opencode-ai/schema/automation"
import { Effect } from "effect"

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
        try {
          const proc = Bun.spawn(["sh", "-c", check.command], {
            cwd: input.directory,
            stdio: ["ignore", "pipe", "pipe"],
          })
          let timedOut = false
          const timer = setTimeout(
            () => {
              timedOut = true
              proc.kill()
            },
            (check.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
          )
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          clearTimeout(timer)
          const combined = [stdout, stderr].filter(Boolean).join("\n").trim()
          const output = timedOut ? `${combined}\n[timed out after ${check.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS}s]`.trim() : combined
          return {
            command: check.command,
            exitCode: timedOut ? 124 : exitCode,
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
            timedOut: false,
          }
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
