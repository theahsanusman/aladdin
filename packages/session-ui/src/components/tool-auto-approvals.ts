export type AutoApproval = {
  action: string
  resources: readonly string[]
  reason: "rule" | "auto"
}

export function readAutoApprovals(metadata: unknown): AutoApproval[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("autoApprovals" in metadata)) return []
  if (!Array.isArray(metadata.autoApprovals)) return []

  return metadata.autoApprovals.filter((record: unknown): record is AutoApproval => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false
    if (!("action" in record) || typeof record.action !== "string" || !record.action.trim()) return false
    if (!("reason" in record) || (record.reason !== "rule" && record.reason !== "auto")) return false
    if (!("resources" in record) || !Array.isArray(record.resources)) return false
    return Array.from(record.resources).every((resource: unknown) => typeof resource === "string" && !!resource.trim())
  })
}
