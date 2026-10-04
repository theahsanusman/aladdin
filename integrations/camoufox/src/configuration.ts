import { z } from "zod"

export function configuration<T extends Record<string, unknown>>(original: T, command: string[]) {
  const mcp = z.record(z.string(), z.unknown()).parse(original.mcp ?? {})
  const permission = z.record(z.string(), z.unknown()).parse(original.permission ?? {})
  const chrome =
    mcp["chrome-devtools"] === undefined ? undefined : z.record(z.string(), z.unknown()).parse(mcp["chrome-devtools"])
  return {
    ...original,
    mcp: {
      ...mcp,
      ...(chrome ? { "chrome-devtools": { ...chrome, enabled: false } } : {}),
      camoufox: { type: "local", enabled: true, command, timeout: 90000 },
    },
    permission: { ...permission, "camoufox_*": "allow" },
  }
}
