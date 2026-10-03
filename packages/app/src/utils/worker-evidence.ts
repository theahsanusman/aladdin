import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(
  Schema.Struct({
    result: Schema.Struct({
      summary: Schema.String,
      checks: Schema.Array(Schema.Struct({ check: Schema.String, passed: Schema.Boolean, evidence: Schema.String })),
    }),
  }),
)
const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export function workerEvidence(text: string) {
  const parsed = json(text)
  if (Option.isNone(parsed)) return
  return Option.getOrUndefined(decode(parsed.value))?.result
}

const failure = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ result: Schema.Struct({ error: Schema.String }) }),
    Schema.Struct({ error: Schema.String }),
  ]),
)

export function workerResultText(text: string) {
  const report = workerEvidence(text)
  if (report) return report.summary
  const parsed = json(text)
  if (Option.isNone(parsed)) return text
  const error = Option.getOrUndefined(failure(parsed.value))
  if (!error) return
  return "result" in error ? error.result.error : error.error
}
