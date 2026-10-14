import { Effect } from "effect"
import { Observability } from "../../src/observability"

const spans = await Effect.gen(function* () {
  yield* Effect.logDebug("telemetry-privacy-debug")
  yield* Effect.logInfo("telemetry-privacy-info")
  yield* Effect.logError("telemetry-privacy-error")
  const parent = yield* Effect.currentSpan
  const child = yield* Effect.currentSpan.pipe(Effect.withSpan("privacy-child"))
  return {
    parent: parent.name,
    child: child.name,
    parentTraceID: parent.traceId,
    childTraceID: child.traceId,
    parentSpanID: parent.spanId,
    childParentSpanID: child.parent._tag === "Some" ? child.parent.value.spanId : undefined,
  }
}).pipe(
  Effect.withSpan("privacy-parent"),
  Effect.annotateLogs({ test: "telemetry-privacy" }),
  Effect.provide(Observability.layer),
  Effect.scoped,
  Effect.runPromise,
)

// Scope disposal flushes the real loggers and any accidentally reintroduced exporters.
process.stdout.write(JSON.stringify(spans))
