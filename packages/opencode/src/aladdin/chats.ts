import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Process } from "@/util/process"

// Folder-less chat sessions live in a single shared workspace so they group as
// one project in Home without asking the user to pick a directory. The
// workspace is a real git repository because project discovery requires one.
export const CHAT_WORKSPACE_NAME = "Aladdin Chats"

export async function ensureChatWorkspace(home = os.homedir()) {
  const directory = path.join(home, "Documents", CHAT_WORKSPACE_NAME)
  await mkdir(directory, { recursive: true })
  if (!existsSync(path.join(directory, ".git"))) {
    // Process.run keeps this working in every runtime the server ships in: the
    // desktop bundles the server for Node, where `Bun.spawn` does not exist.
    const result = await Process.run(["git", "init", "--quiet"], { cwd: directory, nothrow: true })
    if (result.code !== 0)
      throw new Error(result.stderr.toString().trim() || "Failed to initialize chat workspace repository")
  }
  return { directory }
}

export * as Chats from "./chats"
