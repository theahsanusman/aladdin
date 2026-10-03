import { expect, test } from "bun:test"
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { nodeWebUI } from "../../script/web-ui"

test("Node web assets remain local and resolvable when the desktop relocates its backend", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aladdin-node-ui-"))
  try {
    const app = path.join(root, "app")
    const output = path.join(root, "node")
    await mkdir(path.join(app, "assets"), { recursive: true })
    await writeFile(path.join(app, "index.html"), '<html><script src="/assets/app.js"></script></html>')
    await writeFile(path.join(app, "assets/app.js"), "console.log('Aladdin shared chats')")
    await writeFile(path.join(app, "assets/app.js.map"), "private source map")
    const manifest = await nodeWebUI(app, output)
    await writeFile(path.join(output, "web-ui.mjs"), manifest)
    const desktop = path.join(root, "desktop", "chunks")
    await cp(output, desktop, { recursive: true })
    await rm(output, { recursive: true })
    const files = (await import(path.join(desktop, "web-ui.mjs"))).default as Record<string, string>
    expect(await readFile(files["index.html"], "utf8")).toContain("/assets/app.js")
    expect(await readFile(files["assets/app.js"], "utf8")).toContain("Aladdin shared chats")
    expect(files["assets/app.js.map"]).toBeUndefined()
    expect(Object.keys(files)).toEqual(["assets/app.js", "index.html"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
