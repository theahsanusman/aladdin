export function runtimeEpoch() {
  return `local:${process.pid}:${crypto.randomUUID()}`
}

export function runtimeHostAlive(epoch: string) {
  const match = /^local:([1-9][0-9]*):[a-f0-9-]{36}$/.exec(epoch)
  if (!match) return
  const pid = Number(match[1])
  if (!Number.isSafeInteger(pid) || pid > 2_147_483_647) return
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    // Permissions or platform limitations cannot prove the old host stopped.
    return
  }
}
