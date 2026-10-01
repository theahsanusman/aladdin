import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const app = path.join(directory, "dist/mac-arm64/Aladdin.app")
// `process.execPath` is the Node running this script; override only for a specific toolchain.
const buildNode = process.env.ALADDIN_BUILD_NODE ?? process.execPath
const identity = process.env.ALADDIN_CODESIGN_IDENTITY ?? findDevelopmentIdentity()

// The dev config disables signing for ordinary builds. Override only this local
// package run so electron-builder signs frameworks, helpers, and the app inside-out.
execFileSync(buildNode, ["node_modules/electron-builder/cli.js", "--mac", "dir", "--config", "electron-builder.config.ts", `-c.mac.identity=${identity}`], {
  cwd: directory,
  env: { ...process.env, OPENCODE_CHANNEL: "dev", CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  stdio: "inherit",
})

// Verification must cover the nested code too; signing it manually with --deep
// would miss the per-helper entitlements supplied by electron-builder.
execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
  cwd: directory,
  stdio: "inherit",
})

function findDevelopmentIdentity() {
  const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" })
  const match = output.match(/"(Apple Development: [^"]+)"/)
  if (!match) {
    throw new Error("No Apple Development codesigning identity found. Set ALADDIN_CODESIGN_IDENTITY to sign the Aladdin build.")
  }
  return match[1]
}
