import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { PermissionTrusted } from "@opencode-ai/core/permission/trusted"
import { Wildcard } from "@opencode-ai/core/util/wildcard"

describe("PermissionTrusted.directories", () => {
  test("covers system temp and Downloads with raw and realpath globs", () => {
    const globs = PermissionTrusted.directories()
    expect(globs).toContain("/tmp/*")
    expect(globs).toContain(path.join(fs.realpathSync("/tmp"), "*"))
    expect(globs).toContain(path.join(os.homedir(), "Downloads", "*"))
  })

  test("covers chrome-devtools-mcp scratch dirs under the temp root in both forms", () => {
    const globs = PermissionTrusted.directories()
    expect(globs).toContain(path.join(os.tmpdir(), "chrome-devtools-mcp-*", "*"))
    expect(globs).toContain(path.join(fs.realpathSync(os.tmpdir()), "chrome-devtools-mcp-*", "*"))
    if (process.platform === "darwin") {
      expect(globs).toContain(
        path.join(fs.realpathSync(os.tmpdir()).replace(/^\/private/, ""), "chrome-devtools-mcp-*", "*"),
      )
    }
  })

  test("every generated pattern is a well-formed glob", () => {
    for (const glob of PermissionTrusted.directories()) {
      expect(glob.endsWith("*")).toBe(true)
      expect(glob.includes("**")).toBe(false)
      expect(glob).not.toContain("folders*/")
      expect(glob).not.toContain("/T*/")
    }
  })

  test("Chrome scratch trust stays under this user's temp root", () => {
    const allowed = (value: string) => PermissionTrusted.directories().some((glob) => Wildcard.match(value, glob))
    const root = fs.realpathSync(os.tmpdir())
    expect(allowed(path.join(root, "chrome-devtools-mcp-ABC123", "screenshot.png"))).toBe(true)
    // If os.tmpdir() itself is /tmp, the separate /tmp policy covers these.
    if (root === "/tmp" || root === "/private/tmp") return
    expect(allowed(path.join(root, "other-app", "chrome-devtools-mcp-ABC123", "screenshot.png"))).toBe(false)
    expect(allowed("/var/folders/other/user/T/chrome-devtools-mcp-ABC123/screenshot.png")).toBe(false)
    expect(allowed(path.join(root, "opencode-test-data-ABC123", "data.json"))).toBe(false)
  })

  test("covers global skills without granting their parent directories", () => {
    const allowed = (value: string) => PermissionTrusted.directories().some((glob) => Wildcard.match(value, glob))
    expect(allowed(path.join(os.homedir(), ".agents", "skills", "test-driven-development", "SKILL.md"))).toBe(true)
    expect(allowed(path.join(os.homedir(), ".claude", "skills", "testing", "SKILL.md"))).toBe(true)
    expect(allowed(path.join(os.homedir(), ".agents", "private.json"))).toBe(false)
    expect(allowed(path.join(os.homedir(), ".ssh", "id_rsa"))).toBe(false)
  })
})
