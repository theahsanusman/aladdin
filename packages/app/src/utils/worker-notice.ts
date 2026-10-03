export function workerNotice(event: { type: string; properties: unknown }, sessionID?: string) {
  if (!sessionID || (event.type !== "task.changed" && event.type !== "task.team.changed")) return false
  return (
    !!event.properties &&
    typeof event.properties === "object" &&
    "sessionID" in event.properties &&
    event.properties.sessionID === sessionID
  )
}

type WorkerResult = { task: { id: string; status: string }; evidence?: string }

export function workerResultArrived(previous: readonly WorkerResult[], current: readonly WorkerResult[]) {
  return current.some(
    (item) =>
      !!item.evidence &&
      ["completed", "failed", "cancelled", "interrupted"].includes(item.task.status) &&
      !previous.some(
        (old) => old.task.id === item.task.id && old.task.status === item.task.status && old.evidence === item.evidence,
      ),
  )
}
