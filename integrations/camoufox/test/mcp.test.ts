import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { coerceArguments } from "../src/mcp.ts"
import { requestBroker } from "../src/service.ts"

test("stringified structured arguments decode before validation while plain strings stay untouched", () => {
  const decoded = coerceArguments({
    target: '{"kind":"role","role":"button","name":"Save"}',
    values: '["US"]',
    files: '["photo.png"]',
    tab: "t0123456789abcdef-1",
    text: '"quoted"',
  })
  expect(decoded.target).toEqual({ kind: "role", role: "button", name: "Save" })
  expect(decoded.values).toEqual(["US"])
  expect(decoded.files).toEqual(["photo.png"])
  expect(decoded.tab).toBe("t0123456789abcdef-1")
  expect(decoded.text).toBe('"quoted"')
  const malformed = coerceArguments({ target: "Save", values: "US" })
  expect(malformed.target).toBe("Save")
  expect(malformed.values).toBe("US")
  const wrongShape = coerceArguments({ target: '"Save"' })
  expect(wrongShape.target).toBe('"Save"')
  const notJson = coerceArguments({ target: '{"kind":"role"' })
  expect(notJson.target).toBe('{"kind":"role"')
})

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
    const click = tools.tools.find((tool) => tool.name === "click")
    expect(click?.inputSchema).toMatchObject({
      properties: { target: { type: "object", description: expect.stringContaining("JSON object") } },
    })
    expect(JSON.stringify(click?.inputSchema)).not.toContain("$ref")
    expect(first.getInstructions()).toContain("Chrome")
    expect(first.getInstructions()).toContain("default")
    expect(first.getInstructions()).toContain('skill(name="camoufox")')
    expect(first.getInstructions()).toContain("not MCP resources")
    const values = await Promise.all([
      first.callTool({ name: "profiles", arguments: { operation: "list" } }),
      second.callTool({ name: "profiles", arguments: { operation: "list" } }),
    ])
    expect(values.filter((value) => value.isError === true)).toEqual([])
    const invalid = await first.callTool({ name: "profiles", arguments: { operation: "open", profile: "../Chrome" } })
    expect(invalid.isError).toBe(true)
    expect(JSON.stringify(invalid)).not.toContain("../Chrome")
    const invalidTarget = await first.callTool({
      name: "press",
      arguments: { tab: "t0123456789abcdef-1", key: "Enter", target: "private-page-secret" },
    })
    expect(invalidTarget.isError).toBe(true)
    expect(JSON.stringify(invalidTarget)).toContain("object")
    expect(JSON.stringify(invalidTarget)).not.toContain("private-page-secret")
    const stringifiedTarget = await first.callTool({
      name: "press",
      arguments: { tab: "t0123456789abcdef-1", key: "Enter", target: '{"kind":"text","value":"secret-value"}' },
    })
    expect(JSON.stringify(stringifiedTarget)).not.toContain("Invalid browser tool arguments")
    expect(JSON.stringify(stringifiedTarget)).not.toContain("secret-value")
    await first.close()
    const surviving = await second.callTool({ name: "profiles", arguments: { operation: "list" } })
    expect(surviving.isError).not.toBe(true)
  } finally {
    await Promise.allSettled([first.close(), second.close()])
    await requestBroker(root, { control: "stop" }).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
