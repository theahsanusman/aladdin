import { expect, test } from "bun:test"

import { configuration } from "../src/configuration.ts"
const api = { configuration }

test("Camoufox becomes enabled and Chrome keeps its exact auto-connect command while disabled", () => {
  const chrome = { type: "local", enabled: true, command: ["npx", "-y", "chrome-devtools-mcp@latest", "--autoConnect"] }
  const original = {
    provider: { private: { token: "must-be-preserved" } },
    permission: { edit: "allow", bash: { "sudo *": "deny" } },
    mcp: { "chrome-devtools": chrome, context7: { type: "remote", url: "https://example.com" } },
  }
  const updated = api?.configuration(original, ["/node", "/bridge", "mcp"])
  expect(updated).toBeDefined()
  if (!updated) return
  expect(updated.mcp["chrome-devtools"]).toEqual({ ...chrome, enabled: false })
  expect(updated.mcp.camoufox).toEqual({
    type: "local",
    enabled: true,
    command: ["/node", "/bridge", "mcp"],
    timeout: 90000,
  })
  expect(updated.provider).toEqual(original.provider)
  expect(updated.permission).toEqual({ ...original.permission, "camoufox_*": "allow" })
  expect(updated.mcp.context7).toEqual(original.mcp.context7)
  expect(original.mcp["chrome-devtools"].enabled).toBe(true)
})
