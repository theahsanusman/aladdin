import { z } from "zod"

export function configuration<T extends Record<string, unknown>>(original: T, command: string[]) {
  const mcp = z.record(z.string(), z.unknown()).parse(original.mcp ?? {})
  const permission = z.record(z.string(), z.unknown()).parse(original.permission ?? {})
  const chrome =
    mcp["chrome-devtools"] === undefined ? undefined : z.record(z.string(), z.unknown()).parse(mcp["chrome-devtools"])
  const chromeCommand = chrome?.type === "local" ? z.array(z.string()).parse(chrome.command) : undefined
  return {
    ...original,
    mcp: {
      ...mcp,
      // The official server attaches to Chrome only when a browser tool is
      // called. Disabling the MCP removes the tools even for explicit requests.
      ...(chrome
        ? {
            "chrome-devtools": {
              ...chrome,
              enabled: true,
              ...(chromeCommand
                ? {
                    command: chromeCommand.includes("--no-performance-crux")
                      ? chromeCommand
                      : [...chromeCommand, "--no-performance-crux"],
                    environment: {
                      ...z.record(z.string(), z.string()).parse(chrome.environment ?? {}),
                      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
                      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
                    },
                  }
                : {}),
            },
          }
        : {}),
      camoufox: { type: "local", enabled: true, command, timeout: 90000 },
    },
    permission: { ...permission, "camoufox_*": "allow" },
  }
}
