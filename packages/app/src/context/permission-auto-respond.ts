import { base64Encode } from "@opencode-ai/core/util/encode"
import { isDangerousPermission } from "@opencode-ai/core/permission/danger"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  return autoAccept[key] ?? autoAccept[sessionID]
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  // Auto-approve is on by default for every directory; a stored false (the
  // user turned it off) is what keeps it off. The danger gate below still
  // routes dangerous requests to a prompt regardless of this default.
  return autoAccept[key] ?? true
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: {
    sessionID: string
    permission?: string
    patterns?: readonly string[]
    metadata?: Record<string, unknown>
  },
  directory?: string,
) {
  const value = sessionAutoAccept(autoAccept, session, permission, directory)
  const allowed = value !== undefined ? value : directory ? isDirectoryAutoAccepting(autoAccept, directory) : false
  if (!allowed) return false
  // Auto-approve covers safe work only; dangerous requests keep prompting even
  // with auto-accept on. Requests without details are mode checks, not asks.
  if (
    permission.permission !== undefined &&
    isDangerousPermission({ ...permission, permission: permission.permission })
  )
    return false
  return true
}

export function sessionAutoAccept(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: {
    sessionID: string
    permission?: string
    patterns?: readonly string[]
    metadata?: Record<string, unknown>
  },
  directory?: string,
) {
  const override = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  if (override === undefined) return undefined
  // Auto-accept never covers dangerous requests. Reporting them as false keeps
  // every consumer — including respondPending's resolve fast path — prompting.
  const requested = permission.permission
  if (
    override &&
    requested !== undefined &&
    isDangerousPermission({ permission: requested, patterns: permission.patterns, metadata: permission.metadata })
  )
    return false
  return override
}
