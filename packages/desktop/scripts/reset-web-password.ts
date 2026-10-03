import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { resetWebPassword } from "../src/main/web-credentials"

const defaultDirectory = join(homedir(), "Library", "Application Support", "ai.opencode.desktop.dev")
const directory = resolve(process.argv.find((item) => item.startsWith("--directory="))?.slice(12) ?? defaultDirectory)
if (directory === defaultDirectory && process.platform === "darwin") {
  const running = (() => {
    try {
      return !!execFileSync("pgrep", ["-x", "Aladdin"], { encoding: "utf8" }).trim()
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 1) return false
      throw error
    }
  })()
  if (running) {
    console.error("Quit Aladdin normally before resetting its web password, then run this command again.")
    process.exit(1)
  }
}
const supplied = process.argv.includes("--password-stdin") ? (await Bun.stdin.text()).replace(/\r?\n$/, "") : undefined
await resetWebPassword(directory, supplied)
console.log(
  "Aladdin web password reset. Open Aladdin and copy its browser or phone connection link. Username: opencode.",
)
