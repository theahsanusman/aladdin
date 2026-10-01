import { describe, expect, test } from "bun:test"
import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { autoRespondsPermission, isDirectoryAutoAccepting, sessionAutoAccept } from "./permission-auto-respond"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("defaults to auto-accept when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("inherits a parent session's false override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
      [`${base64Encode(directory)}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("falls back to directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(true)
    expect(sessionAutoAccept(autoAccept, sessions, permission("root"), directory)).toBeUndefined()
  })

  test("session-level override takes precedence over directory-level", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(false)
  })

  test("parent false override takes precedence over directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("parent true override takes precedence over disabled directory fallback", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: false,
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })
})

describe("autoRespondsPermission danger gate", () => {
  const sessions = [session({ id: "root" })]
  const directory = "/tmp/project"

  test("does not auto-respond dangerous requests even when auto-accept is on", () => {
    const autoAccept = { root: true }

    expect(
      autoRespondsPermission(
        autoAccept,
        sessions,
        { sessionID: "root", permission: "bash", patterns: ["sudo rm -rf /"] },
        directory,
      ),
    ).toBe(false)
  })

  test("still auto-responds safe requests when auto-accept is on", () => {
    const autoAccept = { root: true }

    expect(
      autoRespondsPermission(
        autoAccept,
        sessions,
        { sessionID: "root", permission: "bash", patterns: ["bun test"] },
        directory,
      ),
    ).toBe(true)
  })

  test("gates dangerous requests even when auto-approve is on by default with no stored entry", () => {
    expect(
      autoRespondsPermission(
        {},
        sessions,
        { sessionID: "root", permission: "bash", patterns: ["sudo rm -rf /"] },
        directory,
      ),
    ).toBe(false)
    expect(
      autoRespondsPermission(
        {},
        sessions,
        { sessionID: "root", permission: "bash", patterns: ["bun test"] },
        directory,
      ),
    ).toBe(true)
  })

  test("gates dangerous requests behind directory-level auto-accept too", () => {
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
    }

    expect(
      autoRespondsPermission(
        autoAccept,
        sessions,
        { sessionID: "root", permission: "webfetch", patterns: ["https://example.com"] },
        directory,
      ),
    ).toBe(false)
    expect(
      autoRespondsPermission(
        autoAccept,
        sessions,
        { sessionID: "root", permission: "read", patterns: ["src/a.ts"] },
        directory,
      ),
    ).toBe(true)
  })

  test("leaves mode checks without request details untouched", () => {
    const autoAccept = { root: true }

    expect(autoRespondsPermission(autoAccept, sessions, { sessionID: "root" }, directory)).toBe(true)
  })

  test("loads skills and reads their supporting folder automatically only in auto mode", () => {
    for (const request of [
      { sessionID: "root", permission: "skill", patterns: ["test-driven-development"] },
      {
        sessionID: "root",
        permission: "external_directory",
        patterns: ["/Users/ahsan/.agents/skills/test-driven-development/*"],
      },
    ]) {
      expect(autoRespondsPermission({}, sessions, request, directory)).toBe(true)
      expect(autoRespondsPermission({ root: false }, sessions, request, directory)).toBe(false)
    }
  })

  test("sessionAutoAccept reports dangerous overrides as false for the resolve fast path", () => {
    const autoAccept = { root: true }

    expect(
      sessionAutoAccept(
        autoAccept,
        sessions,
        { sessionID: "root", permission: "bash", patterns: ["sudo reboot"] },
        directory,
      ),
    ).toBe(false)
    expect(
      sessionAutoAccept(
        autoAccept,
        sessions,
        { sessionID: "root", permission: "bash", patterns: ["bun test"] },
        directory,
      ),
    ).toBe(true)
    expect(sessionAutoAccept(autoAccept, sessions, { sessionID: "root" }, directory)).toBe(true)
  })
})

describe("isDirectoryAutoAccepting", () => {
  test("returns true when directory key is set", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(true)
  })

  test("returns true when directory key is not set (auto-approve defaults on)", () => {
    expect(isDirectoryAutoAccepting({}, "/tmp/project")).toBe(true)
  })

  test("returns false when directory key is explicitly false", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: false }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(false)
  })
})
