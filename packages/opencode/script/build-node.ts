#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import { nodeWebUI } from "./web-ui"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ../app build`
const webUI = await nodeWebUI(path.resolve(dir, "../app/dist"), path.join(dir, "dist/node"))

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": webUI,
  },
})

console.log("Build complete")
