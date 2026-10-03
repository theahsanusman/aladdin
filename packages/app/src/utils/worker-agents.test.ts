import { expect, test } from "bun:test"
import { workerAgent, workerAgents } from "./worker-agents"

test("all detached worker selections use Michael and never fall back to basic agents", () => {
  const agents = [
    { name: "dispatcher" },
    { name: "michael-lead" },
    { name: "michael" },
    { name: "build" },
    { name: "plan" },
    { name: "general" },
  ]
  expect(workerAgents(agents).map((agent) => agent.name)).toEqual(["michael"])
  for (const selected of [undefined, "build", "plan", "general", "michael-lead", "michael"])
    expect(workerAgent(agents, selected, "michael-lead")).toBe("michael")
  expect(workerAgent([{ name: "build" }, { name: "michael-lead" }])).toBeUndefined()
  expect(workerAgent([{ name: "michael", hidden: true }])).toBeUndefined()
})
