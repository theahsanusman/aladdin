import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import os from "os"
import path from "path"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { TrustedPathsPlugin } from "@opencode-ai/core/plugin/trusted-paths"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

describe("AgentV2", () => {
  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service

      expect(yield* agent.all()).toEqual([])
      expect(yield* agent.get(AgentV2.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.all()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
      let description = "Old description"
      let hidden = true
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = description
          info.hidden = hidden
        }),
      )
      description = "New description"
      hidden = false
      yield* agent.reload()

      expect(yield* agent.get(id)).toMatchObject({ description: "New description", hidden: false })
    }),
  )

  it.effect("removes a transform when its scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("build")

      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.mode = "primary"
          info.hidden = true
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, mode: "primary", hidden: true })
    }),
  )

  it.effect("creates agents with runtime defaults and supports direct removal", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      expect(yield* agent.get(id)).toEqual(AgentV2.Info.empty(id))

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("does not ambiently opt built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      const agents = yield* agent.all()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "compaction",
        "explore",
        "general",
        "plan",
        "summary",
        "title",
      ])
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect !== "deny")).toBe(false)
      }
    }),
  )

  it.effect("trusted paths win over blanket external_directory rules but respect exact denies", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const ctx = host({ agent: agentHost(agent) })
      // Simulate config-style rules landing before the trusted-path pass.
      yield* agent.transform((editor) => {
        editor.update(AgentV2.ID.make("probe"), (info) => {
          info.permissions = [{ action: "external_directory", resource: "*", effect: "ask" }]
        })
        editor.update(AgentV2.ID.make("probe-denied"), (info) => {
          info.permissions = [
            { action: "external_directory", resource: "*", effect: "ask" },
            { action: "external_directory", resource: "/tmp/*", effect: "deny" },
          ]
        })
      })
      yield* TrustedPathsPlugin.Plugin.effect(ctx)

      const probe = (yield* agent.get(AgentV2.ID.make("probe")))?.permissions ?? []
      expect(PermissionV2.evaluate("external_directory", "/tmp/scratch", probe).effect).toBe("allow")
      expect(
        PermissionV2.evaluate(
          "external_directory",
          path.join(os.homedir(), ".agents", "skills", "testing", "SKILL.md"),
          probe,
        ).effect,
      ).toBe("allow")
      expect(
        PermissionV2.evaluate("external_directory", path.join(os.homedir(), "Downloads", "file.txt"), probe).effect,
      ).toBe("allow")
      expect(PermissionV2.evaluate("external_directory", "/some/other/path", probe).effect).toBe("ask")

      const denied = (yield* agent.get(AgentV2.ID.make("probe-denied")))?.permissions ?? []
      expect(PermissionV2.evaluate("external_directory", "/tmp/scratch", denied).effect).toBe("deny")
      expect(
        PermissionV2.evaluate("external_directory", path.join(os.homedir(), "Downloads", "file.txt"), denied).effect,
      ).toBe("allow")
    }),
  )
})
