import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Automation } from "@opencode-ai/schema/automation"

const READ_ONLY_TOOLS = ["read", "glob", "grep", "list", "webfetch", "websearch", "lsp", "todowrite"]

function rules(permission: string, action: PermissionV1.Rule["action"]): PermissionV1.Rule[] {
  return [{ permission, pattern: "*", action }]
}

export function ruleset(profile: Automation.Profile): PermissionV1.Rule[] {
  const common: PermissionV1.Rule[] = [
    // Unattended runs must never wait on a human, and the doom-loop guard should
    // not turn into an unanswerable prompt.
    ...rules("question", "deny"),
    ...rules("doom_loop", "allow"),
    ...READ_ONLY_TOOLS.flatMap((tool) => rules(tool, "allow")),
  ]

  if (profile === "read-only") {
    return [
      ...common,
      ...rules("edit", "deny"),
      ...rules("task", "deny"),
      ...rules("external_directory", "deny"),
    ]
  }

  if (profile === "workspace-write") {
    return [...common, ...rules("edit", "allow"), ...rules("task", "allow"), ...rules("external_directory", "deny")]
  }

  return [
    ...common,
    ...rules("edit", "allow"),
    ...rules("task", "allow"),
    ...rules("external_directory", "allow"),
  ]
}

export * as Profiles from "./profiles"
