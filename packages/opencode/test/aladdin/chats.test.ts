import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { CHAT_WORKSPACE_NAME, ensureChatWorkspace } from "../../src/aladdin/chats"

describe("Aladdin chat workspace", () => {
  test("creates the folder-less chat directory under Documents and initializes git", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "aladdin-home-"))
    try {
      const result = await ensureChatWorkspace(home)
      expect(result.directory).toBe(path.join(home, "Documents", CHAT_WORKSPACE_NAME))
      expect(existsSync(result.directory)).toBe(true)
      expect(existsSync(path.join(result.directory, ".git"))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test("is idempotent and keeps existing contents intact", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "aladdin-home-"))
    try {
      const first = await ensureChatWorkspace(home)
      await writeFile(path.join(first.directory, "marker.txt"), "kept")
      const second = await ensureChatWorkspace(home)
      expect(second.directory).toBe(first.directory)
      expect(await readFile(path.join(first.directory, "marker.txt"), "utf8")).toBe("kept")
      expect(existsSync(path.join(first.directory, ".git"))).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
