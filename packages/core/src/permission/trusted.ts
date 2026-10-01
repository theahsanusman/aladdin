export * as PermissionTrusted from "./trusted"

import fs from "fs"
import os from "os"
import path from "path"

// Appended after configured rules; exact pattern denies remain an escape hatch.
// Never trust os.tmpdir() wholesale: it also contains app data and test homes.
export function directories(): string[] {
  const candidates = [
    { directory: "/tmp", pattern: "*" },
    { directory: path.join(os.homedir(), "Downloads"), pattern: "*" },
    { directory: os.tmpdir(), pattern: "chrome-devtools-mcp-*/*" },
    { directory: path.join(os.homedir(), ".agents", "skills"), pattern: "*" },
    { directory: path.join(os.homedir(), ".claude", "skills"), pattern: "*" },
  ]
  return [
    ...new Set(
      candidates.flatMap((candidate) => {
        const roots = fs.existsSync(candidate.directory)
          ? [candidate.directory, fs.realpathSync(candidate.directory)]
          : [candidate.directory]
        // macOS callers may use /var or /private/var for the same temp directory.
        return roots
          .flatMap((root) => (root.startsWith("/private/var/") ? [root, root.slice(8)] : [root]))
          .map((root) => path.join(root, candidate.pattern))
      }),
    ),
  ]
}
