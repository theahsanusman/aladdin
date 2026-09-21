import { Schema } from "effect"

export const TTL_MS = 30 * 60_000

export class ClaimConflictError extends Schema.TaggedErrorClass<ClaimConflictError>()("Automation.ClaimConflict", {
  path: Schema.String,
  owner: Schema.String,
  sessionID: Schema.String,
}) {}

interface Claim {
  path: string
  sessionID: string
  callID?: string
  time: number
}

const claims = new Map<string, Claim>()

function reap(now: number) {
  for (const [path, claim] of claims) {
    if (now - claim.time > TTL_MS) claims.delete(path)
  }
}

/** Returns a conflict error when any path is claimed by a different session. */
export function acquire(input: { sessionID: string; paths: ReadonlyArray<string>; callID?: string }) {
  const now = Date.now()
  reap(now)
  for (const path of input.paths) {
    const existing = claims.get(path)
    if (existing && existing.sessionID !== input.sessionID) {
      return new ClaimConflictError({ path, owner: existing.sessionID, sessionID: input.sessionID })
    }
  }
  for (const path of input.paths) {
    claims.set(path, { path, sessionID: input.sessionID, callID: input.callID, time: now })
  }
  return undefined
}

export function releaseSession(sessionID: string) {
  for (const [path, claim] of claims) {
    if (claim.sessionID === sessionID) claims.delete(path)
  }
}

export function list() {
  reap(Date.now())
  return [...claims.values()]
}

export function clear() {
  claims.clear()
}

export * as Claim from "./registry"
