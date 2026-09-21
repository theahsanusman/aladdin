import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const app = path.join(directory, "dist/mac-arm64/Aladdin.app")
const identity = process.env.ALADDIN_CODESIGN_IDENTITY ?? "Apple Development: Ahsan Usman (2KG65UJYX2)"
const buildNode = process.env.ALADDIN_BUILD_NODE ?? "/opt/homebrew/Cellar/node/23.11.0/bin/node"

execFileSync(buildNode, ["node_modules/electron-builder/cli.js", "--mac", "dir", "--config", "electron-builder.config.ts"], {
  cwd: directory,
  env: { ...process.env, OPENCODE_CHANNEL: "dev", CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  stdio: "inherit",
})
execFileSync("codesign", ["--force", "--deep", "--options", "runtime", "--entitlements", "resources/entitlements.plist", "--sign", identity, app], {
  cwd: directory,
  stdio: "inherit",
})
execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
  cwd: directory,
  stdio: "inherit",
})
