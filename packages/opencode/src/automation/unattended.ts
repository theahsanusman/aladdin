const sessions = new Set<string>()

export function mark(sessionID: string) {
  sessions.add(sessionID)
}

export function unmark(sessionID: string) {
  sessions.delete(sessionID)
}

export function isUnattended(sessionID: string) {
  return sessions.has(sessionID)
}

export function clear() {
  sessions.clear()
}

export * as Unattended from "./unattended"
