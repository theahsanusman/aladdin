export * as PermissionDanger from "./danger"

// Classifies permission requests for the composer's auto-approve mode: anything
// flagged here keeps asking the user even when auto-approve is on. The rules
// are deterministic on purpose — a security gate must not be guessable or
// bypassable by the content it is guarding against. Unrecognized permissions
// fail closed (they ask).

type PermissionLike = {
  permission: string
  patterns?: readonly string[]
  metadata?: Record<string, unknown>
}

// Read-only, non-destructive tool keys. They still pass through the
// sensitive-path check below before being auto-approved.
const SAFE_PERMISSIONS = new Set(["read", "glob", "grep", "list", "todowrite", "lsp", "websearch", "question", "goal"])

const SENSITIVE_PATH_KEYS = new Set(["read", "glob", "grep", "list"])

const SENSITIVE_PATH = [
  // Secrets: .env, .env.local and friends (but .env.example style files are fine).
  /\.env(?![.\w])/,
  /\.env\.(local|development|production|test)\b/,
  /(^|[/\\])\.ssh([/\\]|$)/,
  /(^|[/\\])\.aws([/\\]|$)/,
  /(^|[/\\])\.gnupg([/\\]|$)/,
  /(^|[/\\])\.git[/\\]hooks([/\\]|$)/,
  /(id_rsa|id_ed25519)\b/,
  /\.pem\b/,
  /\.ppk\b/,
  /\.npmrc\b/,
  /(^|[/\\])\.netrc\b/,
  /(^|[/\\])\.(bashrc|zshrc|profile|bash_profile|zprofile|zshenv)\b/,
  /Library[/\\]LaunchAgents/,
]

// Command rules cover the classes the user must always vet: privilege
// escalation, mass deletion, disk/system damage, pipe-to-shell execution,
// credential access, data exfiltration, destructive git, and persistence writes.
const DANGEROUS_COMMANDS: RegExp[] = [
  /(^|[\s;&| (`])sudo\s/i,
  /(^|[\s;&| (`])doas\s/i,
  /\|\s*((ba|z|k|da|fi|c)?sh)\b/i,
  /(^|[\s;&| (`])eval\s/,
  // Recursive rm is treated as mass deletion; single-file rm stays automatic.
  /(^|[\s;&| (`])rm\s+-[a-z]*[rR]/,
  /(^|[\s;&| (`])rm\s+--recursive/,
  /(^|[\s;&| (`])find\s[^\n]*-delete\b/,
  /(^|[\s;&| (`])xargs\s+(rm|shutil)\b/i,
  /(^|[\s;&| (`])(dd|mkfs|shred|fdisk|parted|wipefs)\b/i,
  /diskutil\s+(erase|partition)/i,
  /(^|[\s;&| (`])(shutdown|reboot|halt|poweroff)\b/i,
  /(^|[\s;&| (`])killall\s/i,
  /(^|[\s;&| (`])crontab\s/i,
  /launchctl\s+(load|unload|bootstrap|bootout)\b/,
  /chmod\s+[^&|;\n]*(777|a\+rwx)\b/,
  /chmod\s+[^&|;\n]*\+s\b/,
  /(^|[\s;&| (`])chown\s+(-[a-z]+\s+)*-R\b/,
  // --force-with-lease is the safe alternative, so --force must not match it.
  /(^|[\s;&| (`])git\s+push\b(?=[^\n]*\s-f\b)/,
  /(^|[\s;&| (`])git\s+push\b(?=[^\n]*--force(?!-))/,
  /(^|[\s;&| (`])git\s+push\b(?=[^\n]*--delete\b)/,
  /(^|[\s;&| (`])git\s+reset\s+--hard\b/,
  /(^|[\s;&| (`])git\s+clean\s+-[a-z]*f/i,
  /(^|[\s;&| (`])git\s+branch\s+-D\b/,
  // Outbound data transfer: the send flags of curl/wget, remote copy, raw sockets.
  /(^|[\s;&| (`])(curl|wget)\s[^\n]*(\s-d(\s|@|=)|--data|--form\b|\s-F\s|--upload-file|--post-file|--post\b|\s-T\s)/,
  /(^|[\s;&| (`])(scp|sftp|rsync|ftp)\s/i,
  /(^|[\s;&| (`])(nc|ncat|socat|telnet)\s/i,
  /(^|[\s;&| (`])ssh\s/i,
  /~\/\.(ssh|aws|gnupg|netrc)\b/,
  /(id_rsa|id_ed25519)\b/,
  /\.pem\b/,
  /\.ppk\b/,
  /\.npmrc\b/,
  /(^|[\s;&| (`])security\s+(dump|find-|export)/i,
  /\.env(?![.\w])/,
  /\.env\.(local|development|production|test)\b/,
  />>?\s*(~\/|\/|\.{1,2}\/)?\.(bashrc|zshrc|profile|bash_profile|zprofile|zshenv)\b/,
  /Library\/LaunchAgents/,
]

export function isDangerousPermission(request: PermissionLike): boolean {
  const patterns = request.patterns ?? []

  // Trusted temp scratch (chrome-devtools-mcp) is safe to auto-approve even
  // though external_directory otherwise fails closed: the glob pins the path
  // to one random per-session dir under the system temp root.
  if (request.permission === "external_directory") {
    if (patterns.length === 0) return true
    return !patterns.every(
      (value) =>
        !isSensitivePath(value) &&
        !/(^|[/\\])\.\.([/\\]|$)/.test(value) &&
        TRUSTED_EXTERNAL.some((rule) => rule.test(value)),
    )
  }

  // Loading a registered skill reads instructions; any scripts it recommends
  // still run through the ordinary shell and file permission checks.
  if (request.permission === "skill") {
    return patterns.length === 0 || !patterns.every((name) => /^[\w-]+$/.test(name))
  }

  if (request.permission === "bash") {
    const command = typeof request.metadata?.command === "string" ? request.metadata.command : undefined
    const candidates = command ? [...patterns, command] : patterns
    if (candidates.length === 0) return true
    return candidates.some((value) => DANGEROUS_COMMANDS.some((rule) => rule.test(value)))
  }

  if (request.permission === "edit") {
    return patterns.some((value) => isSensitivePath(value) || isOutsideWorkspace(value))
  }

  if (SENSITIVE_PATH_KEYS.has(request.permission)) {
    return patterns.some((value) => isSensitivePath(value))
  }

  // Network fetches cross a trust boundary: fetched content is a prompt-injection
  // vector and mirrors Codex treating the network as an approval boundary.
  if (request.permission === "webfetch") return true

  return !SAFE_PERMISSIONS.has(request.permission)
}

function isSensitivePath(value: string) {
  return SENSITIVE_PATH.some((rule) => rule.test(value))
}

// external_directory patterns that are safe to auto-approve: the temp-rooted
// chrome-devtools-mcp scratch dirs. Raw and realpath forms both match.
const TRUSTED_EXTERNAL = [
  /^\/(?:private\/)?var\/folders\/[\w-]+\/[\w-]+\/T\/chrome-devtools-mcp-[\w-]+\/(?:[\w./ -]+\/)?\*?$/,
  /^\/(?:private\/)?tmp\/(?:[\w./ -]+\/)?\*?$/,
  /^(?:~|\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\/Users\/[^/]+)\/\.(?:agents|claude)\/skills\/(?:[\w./ -]+\/)?\*?$/,
]

function isOutsideWorkspace(value: string) {
  return /^[~/]|^[A-Za-z]:[\\/]|(^|[\\/])\.\.([\\/]|$)/.test(value)
}
