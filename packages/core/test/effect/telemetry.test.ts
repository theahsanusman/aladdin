import { expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { it } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"

const cases = [
  { name: "generic endpoint", endpoint: true, signals: false, print: "1", level: "INFO" },
  { name: "signal-specific endpoints", endpoint: false, signals: true, print: "0", level: "INFO" },
  { name: "all endpoints", endpoint: true, signals: true, print: "1", level: "DEBUG" },
  { name: "no endpoints", endpoint: false, signals: false, print: "0", level: "DEBUG" },
] as const

cases.forEach((input) => {
  it.live(
    `observability keeps logs and spans local with ${input.name}`,
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(Effect.promise(tmpdir), (dir) =>
        Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const requests: string[] = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request) {
              requests.push(new URL(request.url).pathname)
              return Response.json({})
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      // A fresh process is required: exporter flags and global paths are captured at import time.
      // Give it only synthetic telemetry and isolated paths, never inherited credentials or logs.
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/observability.ts")], {
            env: {
              HOME: dir.path,
              XDG_DATA_HOME: path.join(dir.path, "data"),
              XDG_CONFIG_HOME: path.join(dir.path, "config"),
              XDG_CACHE_HOME: path.join(dir.path, "cache"),
              XDG_STATE_HOME: path.join(dir.path, "state"),
              OPENCODE_CHANNEL: "dev",
              OPENCODE_PRINT_LOGS: input.print,
              OPENCODE_LOG_LEVEL: input.level,
              OTEL_EXPORTER_OTLP_ENDPOINT: input.endpoint ? server.url.origin : "",
              OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: input.signals ? `${server.url.origin}/v1/logs` : "",
              OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: input.signals ? `${server.url.origin}/v1/traces` : "",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: input.signals ? `${server.url.origin}/v1/metrics` : "",
              OTEL_EXPORTER_OTLP_HEADERS: "x-privacy-test=synthetic",
              OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-privacy-test=synthetic",
              OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-privacy-test=synthetic",
              OTEL_LOGS_EXPORTER: "otlp",
              OTEL_TRACES_EXPORTER: "otlp",
              OTEL_METRICS_EXPORTER: "otlp",
              OTEL_SDK_DISABLED: "false",
              OTEL_BSP_SCHEDULE_DELAY: "1",
              OTEL_RESOURCE_ATTRIBUTES: "test.name=telemetry-privacy",
            },
            stdout: "pipe",
            stderr: "pipe",
          }),
        ),
        (child) =>
          Effect.sync(() => {
            if (child.exitCode === null) child.kill()
          }),
      )
      const [stdout, stderr, code] = yield* Effect.promise(() =>
        Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
      )

      expect(code, stderr).toBe(0)
      expect(requests).toEqual([])

      const file = yield* Effect.promise(() => Bun.file(path.join(dir.path, "data/opencode/log/opencode.log")).text())
      expect(file).toContain("level=INFO")
      expect(file).toContain("message=telemetry-privacy-info")
      expect(file).toContain("level=ERROR")
      expect(file).toContain("message=telemetry-privacy-error")
      expect(file).toContain("test=telemetry-privacy")
      if (input.level === "DEBUG") expect(file).toContain("message=telemetry-privacy-debug")
      if (input.level === "INFO") expect(file).not.toContain("message=telemetry-privacy-debug")
      if (input.print === "1") expect(stderr).toContain("message=telemetry-privacy-info")
      if (input.print === "0") expect(stderr).toBe("")

      const spans = JSON.parse(stdout)
      expect(spans).toMatchObject({ parent: "privacy-parent", child: "privacy-child" })
      expect(spans.parentTraceID).toBeTruthy()
      expect(spans.childTraceID).toBe(spans.parentTraceID)
      expect(spans.childParentSpanID).toBe(spans.parentSpanID)
    }),
    15_000,
  )
})
