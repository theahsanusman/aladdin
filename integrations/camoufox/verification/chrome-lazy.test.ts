import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { browserEnvironment } from "../src/profiles.ts"

test("official Chrome MCP lists its tools without contacting a browser, then connects only on a browser call", async () => {
  const entry = process.env.ALADDIN_CHROME_DEVTOOLS_ENTRY
  expect(entry).toBeDefined()
  if (!entry) throw new Error("Pass the installed official Chrome DevTools MCP entry path")
  const requests: string[] = []
  const endpoint = createServer((request, response) => {
    requests.push(request.url ?? "")
    response.writeHead(503).end("No browser is running in this verification endpoint")
  })
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve))
  const address = endpoint.address()
  if (!address || typeof address === "string") throw new Error("No local verification port")
  const client = new Client({ name: "aladdin-chrome-lazy-test", version: "1" })
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.env.ALADDIN_CAMOUFOX_NODE ?? process.execPath,
        args: [
          entry,
          "--browserUrl",
          `http://127.0.0.1:${address.port}`,
          "--no-usage-statistics",
          "--no-performance-crux",
        ],
        env: { ...browserEnvironment(process.env), CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1" },
        stderr: "pipe",
      }),
    )
    expect(requests).toEqual([])
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain("list_pages")
    expect(tools.tools.map((tool) => tool.name)).toContain("new_page")
    expect(requests).toEqual([])
    const result = await client.callTool({ name: "list_pages", arguments: {} })
    expect(requests.length).toBeGreaterThan(0)
    expect(result.isError).toBe(true)
  } finally {
    await client.close()
    await new Promise<void>((resolve, reject) => endpoint.close((error) => (error ? reject(error) : resolve())))
  }
}, 30000)
