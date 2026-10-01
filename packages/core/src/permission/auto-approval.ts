export * as PermissionAutoApproval from "./auto-approval"

import { Option, Schema } from "effect"

const Record = Schema.Struct({
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  reason: Schema.Literals(["rule", "auto"]),
})
const decode = Schema.decodeUnknownOption(Schema.Array(Record))

export function append(metadata: { [key: string]: unknown }, record: typeof Record.Type) {
  const entries = Option.getOrElse(decode(metadata.autoApprovals), () => [])
  const key = JSON.stringify(record)
  return {
    ...metadata,
    autoApprovals: entries.some((entry) => JSON.stringify(entry) === key) ? entries : [...entries, record],
  }
}

export function preserve(metadata: { [key: string]: unknown }, previous: { [key: string]: unknown }) {
  const entries = Option.getOrElse(decode(previous.autoApprovals), () => [])
  const incoming = Option.getOrElse(decode(metadata.autoApprovals), () => [])
  const combined = [...entries, ...incoming].filter((entry, index, all) => all.findIndex((item) => JSON.stringify(item) === JSON.stringify(entry)) === index)
  return combined.length ? { ...metadata, autoApprovals: combined } : metadata
}
