export * as TrustedPathsPlugin from "./trusted-paths"

import { define } from "./internal"
import { Effect } from "effect"
import { PermissionV2 } from "../permission"
import { PermissionTrusted } from "../permission/trusted"

// Product policy: appended after every other agent transform (including
// config rules) so the system temp and Downloads directories stay usable even
// when config asks or denies external_directory wholesale. An explicit deny on
// one of these exact patterns is respected as the escape hatch.
export const Plugin = define({
  id: "trusted-paths",
  effect: Effect.fn(function* (ctx) {
    const rules: PermissionV2.Ruleset = PermissionTrusted.directories().map(
      (resource): PermissionV2.Rule => ({ action: "external_directory", resource, effect: "allow" }),
    )
    yield* ctx.agent.transform((draft) => {
      for (const current of draft.list()) {
        draft.update(current.id, (agent) => {
          const denied = new Set(
            agent.permissions
              .filter((rule) => rule.action === "external_directory" && rule.effect === "deny")
              .map((rule) => rule.resource),
          )
          for (const rule of rules) {
            if (denied.has(rule.resource)) continue
            agent.permissions.push(rule)
          }
        })
      }
    })
  }),
})
