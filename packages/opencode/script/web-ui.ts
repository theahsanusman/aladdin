import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"

// Node cannot use Bun's compiled-in file imports. Keep the manifest relative to
// its backend chunk so Electron can move the chunk and its web directory together.
export async function nodeWebUI(app: string, output: string) {
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: app, onlyFiles: true })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  if (!files.includes("index.html")) throw new Error("Aladdin web UI build is missing index.html")
  await mkdir(output, { recursive: true })
  await rm(path.join(output, "web"), { recursive: true, force: true })
  await cp(app, path.join(output, "web"), { recursive: true, filter: (file) => !file.endsWith(".map") })
  return [
    'import path from "node:path";',
    "export default {",
    ...files.map(
      (file) => `  ${JSON.stringify(file)}: path.join(import.meta.dirname, "web", ${JSON.stringify(file)}),`,
    ),
    "};",
  ].join("\n")
}
