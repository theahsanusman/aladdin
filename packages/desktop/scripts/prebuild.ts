#!/usr/bin/env bun
import { $ } from "bun"
import { chmod, copyFile } from "node:fs/promises"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
if (channel === "dev") await writeFile("resources/aladdin-speech-home.txt", resolve("../opencode/script/aladdin-speech"))
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

if (channel === "dev" && process.platform === "darwin" && process.arch === "arm64") {
  // Keep the web UI embedded: the desktop shows its own renderer, but the mobile listener serves this
  // bundle to phones on the same network, and a phone must load Aladdin's app rather than the hosted one.
  await $`cd ../opencode && bun script/build.ts --single --skip-install`
  await copyFile("../opencode/dist/opencode-darwin-arm64/bin/opencode", "resources/opencode-cli")
  await chmod("resources/opencode-cli", 0o755)
  if (process.platform === "darwin") await $`codesign --force --sign - resources/opencode-cli`
}
if (channel === "dev" && (process.platform !== "darwin" || process.arch !== "arm64")) await downloadCliToResources()
await $`cd ../opencode && bun script/build-node.ts`
