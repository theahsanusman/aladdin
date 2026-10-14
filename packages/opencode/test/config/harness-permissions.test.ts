import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect, Exit } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { ConfigParse } from "../../src/config/parse"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const file = path.resolve(import.meta.dir, "../../../../.opencode/opencode.jsonc")
const harness = ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(await Bun.file(file).text(), file), file)
const it = testEffect(LayerNode.compile(LayerNode.group([Agent.node, Permission.node])))

for (const name of ["build", "general", "explore"]) {
  it.instance(
    `${name} runs harness websearch without a client approval or pending request`,
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const permissions = yield* Permission.Service
        const agent = yield* agents.get(name)

        expect(Permission.evaluate("websearch", "current documentation", agent.permission).action).toBe("allow")
        yield* permissions.ask({
          sessionID: SessionID.descending(),
          permission: "websearch",
          patterns: ["current documentation"],
          always: ["*"],
          metadata: { query: "current documentation" },
          ruleset: agent.permission,
        })
        expect(yield* permissions.list()).toEqual([])
      }),
    { config: { permission: harness.permission } },
  )
}

it.instance(
  "automatic harness websearch keeps network, external-directory and sensitive-read approval boundaries",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const agent = yield* agents.get("build")

      for (const [permission, resource, action] of [
        ["webfetch", "https://example.com", "ask"],
        ["context7_query-docs", "*", "ask"],
        ["external_directory", "/untrusted/outside/*", "ask"],
        ["doom_loop", "*", "ask"],
        ["read", ".env", "ask"],
        ["read", ".env.example", "allow"],
      ] as const) {
        expect(Permission.evaluate(permission, resource, agent.permission).action).toBe(action)
      }
    }),
  { config: { permission: harness.permission } },
)

it.instance(
  "automatic harness websearch does not override an explicit agent denial",
  () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const permissions = yield* Permission.Service
      const agent = yield* agents.get("restricted")
      const exit = yield* permissions
        .ask({
          sessionID: SessionID.descending(),
          permission: "websearch",
          patterns: ["current documentation"],
          always: ["*"],
          metadata: {},
          ruleset: agent.permission,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* permissions.list()).toEqual([])
    }),
  {
    config: {
      permission: harness.permission,
      agent: { restricted: { permission: { websearch: "deny" } } },
    },
  },
)
