import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { requestBroker } from "../src/service.ts"

test("the real stdio MCP advertises scoped browser tools and concurrent clients share a broker", async () => {
  const root = await mkdtemp("/private/tmp/aladdin-mcp-test-")
  const first = new Client({ name: "aladdin-test-one", version: "1" })
  const second = new Client({ name: "aladdin-test-two", version: "1" })
  const entry = process.env.ALADDIN_CAMOUFOX_ENTRY ?? join(import.meta.dir, "../src/cli.ts")
  const options = {
    command: process.env.ALADDIN_CAMOUFOX_NODE ?? process.execPath,
    args: [entry, "mcp", "--root", root, "--executable", "/private/tmp/not-launched-by-unit-tests"],
    stderr: "pipe" as const,
  }
  try {
    await Promise.all([
      first.connect(new StdioClientTransport(options)),
      second.connect(new StdioClientTransport(options)),
    ])
    const tools = await first.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain("profiles")
    expect(tools.tools.map((tool) => tool.name)).not.toContain("evaluate")
    expect(first.getInstructions()).toContain("Chrome")
    expect(first.getInstructions()).toContain("default")
    const values = await Promise.all([
      first.callTool({ name: "profiles", arguments: { operation: "list" } }),
      second.callTool({ name: "profiles", arguments: { operation: "list" } }),
    ])
    expect(values.filter((value) => value.isError === true)).toEqual([])
    const invalid = await first.callTool({ name: "profiles", arguments: { operation: "open", profile: "../Chrome" } })
    expect(invalid.isError).toBe(true)
    expect(JSON.stringify(invalid)).not.toContain("../Chrome")
    await first.close()
    const surviving = await second.callTool({ name: "profiles", arguments: { operation: "list" } })
    expect(surviving.isError).not.toBe(true)
  } finally {
    await Promise.allSettled([first.close(), second.close()])
    await requestBroker(root, { control: "stop" }).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
