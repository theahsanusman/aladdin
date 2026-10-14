import { expect, test } from "bun:test"
import { shapes } from "../src/contracts.ts"

test("the Camoufox skill documents every live tool and validates its JSON examples", async () => {
  const content = await Bun.file(new URL("../skills/camoufox/SKILL.md", import.meta.url)).text()
  expect(content).toContain("name: camoufox")
  expect(content).toContain("target is a JSON object")
  expect(content).toContain("not MCP resources")
  const examples = Array.from(content.matchAll(/```json\n([\s\S]*?)\n```/g), (match) => JSON.parse(match[1]!))
  expect(examples).toHaveLength(Object.keys(shapes).length)
  for (const [name, schema] of Object.entries(shapes)) {
    expect(content).toContain(`camoufox_${name}`)
    const example = examples.find((item) => item.tool === `camoufox_${name}`)
    expect(example).toBeDefined()
    expect(schema.safeParse(example.arguments).success).toBe(true)
  }
})
