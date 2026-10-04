import { expect, test } from "bun:test"

import { configuration } from "../src/configuration.ts"
const api = { configuration }

test("Camoufox becomes default while existing Chrome auto-connect tools remain available for explicit requests", () => {
  const chrome = {
    type: "local",
    enabled: false,
    command: ["npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect"],
  }
  const original = {
    provider: { private: { token: "must-be-preserved" } },
    permission: { edit: "allow", bash: { "sudo *": "deny" } },
    mcp: { "chrome-devtools": chrome, context7: { type: "remote", url: "https://example.com" } },
  }
  const updated = api?.configuration(original, ["/node", "/bridge", "mcp"])
  expect(updated).toBeDefined()
  if (!updated) return
  expect(updated.mcp["chrome-devtools"]).toEqual({
    ...chrome,
    enabled: true,
    command: [...chrome.command, "--no-performance-crux"],
    environment: {
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
    },
  })
  expect(updated.mcp.camoufox).toEqual({
    type: "local",
    enabled: true,
    command: ["/node", "/bridge", "mcp"],
    timeout: 90000,
  })
  expect(updated.provider).toEqual(original.provider)
  expect(updated.permission).toEqual({ ...original.permission, "camoufox_*": "allow" })
  expect(updated.mcp.context7).toEqual(original.mcp.context7)
  expect(original.mcp["chrome-devtools"].enabled).toBe(false)
})

test("Chrome readiness is idempotent and retains existing environment settings", () => {
  const original = {
    mcp: {
      "chrome-devtools": {
        type: "local",
        enabled: false,
        command: ["npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect", "--no-performance-crux"],
        environment: { CUSTOM_SETTING: "preserve" },
      },
    },
  }
  const first = configuration(original, ["/node", "/bridge", "mcp"])
  const second = configuration(first, ["/node", "/bridge", "mcp"])
  expect(second).toEqual(first)
  expect(first.mcp["chrome-devtools"]).toMatchObject({
    command: original.mcp["chrome-devtools"].command,
    environment: { CUSTOM_SETTING: "preserve", CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1" },
  })
})

test("configuration does not add a Chrome connector when none was previously configured", () => {
  const updated = configuration({}, ["/node", "/bridge", "mcp"])
  expect(updated.mcp["chrome-devtools"]).toBeUndefined()
})
