import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Folder-less chat sessions live in a single shared workspace so they group as
// one project in Home without asking the user to pick a directory. The
// workspace is a real git repository because project discovery requires one.
export const CHAT_WORKSPACE_NAME = "Aladdin Chats"

export async function ensureChatWorkspace(home = os.homedir()) {
  const directory = path.join(home, "Documents", CHAT_WORKSPACE_NAME)
  await mkdir(directory, { recursive: true })
  if (!existsSync(path.join(directory, ".git"))) {
    const proc = Bun.spawn(["git", "init", "--quiet"], { cwd: directory, stdout: "pipe", stderr: "pipe" })
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
    if (code !== 0) throw new Error(stderr.trim() || "Failed to initialize chat workspace repository")
  }
  return { directory }
}

export * as Chats from "./chats"
