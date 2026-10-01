import { beforeAll, describe, expect, test } from "bun:test"
import { plugin } from "bun"
import { createRequire } from "node:module"
import { createComponent } from "solid-js"
import { renderToString } from "solid-js/web"
import { readAutoApprovals } from "./tool-auto-approvals"

let component: typeof import("./tool-auto-approval").ToolAutoApproval

beforeAll(async () => {
  // Bun does not compile Solid JSX. Use the UI's existing compiler in memory, without a server or DOM mocks.
  const ui = createRequire(import.meta.resolve("@opencode-ai/ui/package.json"))
  const compiler = createRequire(ui.resolve("vite-plugin-solid"))
  const babel: unknown = compiler("@babel/core")
  if (!babel || typeof babel !== "object" || !("transformSync" in babel) || typeof babel.transformSync !== "function")
    throw new Error("Solid compiler is unavailable")
  const source = new URL("./tool-auto-approval.tsx", import.meta.url)
  const result: unknown = babel.transformSync(await Bun.file(source).text(), {
    filename: source.pathname,
    configFile: false,
    babelrc: false,
    presets: [
      [compiler.resolve("babel-preset-solid"), { generate: "ssr", hydratable: false }],
      compiler.resolve("@babel/preset-typescript"),
    ],
  })
  if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string")
    throw new Error("Solid component compilation returned no code")
  const code = result.code
  plugin({
    name: "solid-auto-approval-test",
    setup(build) {
      build.onLoad({ filter: /\/tool-auto-approval\.tsx$/ }, () => ({ contents: code, loader: "js" }))
    },
  })
  const { ToolAutoApproval } = await import("./tool-auto-approval")
  component = ToolAutoApproval
})

function render(metadata: unknown) {
  return renderToString(() => createComponent(component, { approvals: readAutoApprovals(metadata) }))
}

describe("ToolAutoApproval", () => {
  test.each([
    {},
    { tool: "read", mode: "auto" },
    { autoApprovals: [] },
    { autoApprovals: [{ action: "read", resources: ["/project"], reason: "manual" }] },
  ])("renders nothing without valid recorded approvals %j", (metadata) => {
    expect(render(metadata)).toBe("")
  })

  test("provides a closed native disclosure and keyboard-focusable details", () => {
    const html = render({
      autoApprovals: [{ action: "read", resources: ["/project/src/index.ts"], reason: "rule" }],
    })

    expect(html).toContain('<details data-component="tool-auto-approval"')
    expect(html).not.toMatch(/<details[^>]*\sopen[\s=>]/)
    expect(html).toMatch(/<summary[^>]*>.*Auto-approved.*<\/summary>/)
    expect(html).toContain('role="region"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="Automatically approved actions and resources"')
  })

  test("shows every recorded action and resource, including actions with no resources", () => {
    const html = render({
      autoApprovals: [
        { action: "shell", resources: ["bun test", "/project/scripts/check.sh"], reason: "auto" },
        { action: "external_directory", resources: ["/tmp/review"], reason: "rule" },
        { action: "custom_action", resources: [], reason: "auto" },
      ],
    })

    expect(html).toContain("shell")
    expect(html).toContain("bun test")
    expect(html).toContain("/project/scripts/check.sh")
    expect(html).toContain("external_directory")
    expect(html).toContain("/tmp/review")
    expect(html).toContain("custom_action")
  })

  test("isolates mixed-script paths as LTR while leaving actions direction-aware", () => {
    const html = render({
      autoApprovals: [{ action: "قراءة", resources: ["C:\\work\\تقرير.txt"], reason: "auto" }],
    })

    expect(html).toMatch(/<bdi[^>]*dir="auto"[^>]*>قراءة<\/bdi>/)
    expect(html).toMatch(/<bdi[^>]*dir="ltr"[^>]*>C:\\work\\تقرير\.txt<\/bdi>/)
    expect(html).not.toMatch(/<details[^>]*dir="ltr"/)
  })

  test("escapes recorded text instead of treating it as tool-provided markup", () => {
    const html = render({
      autoApprovals: [{ action: "<script>alert(1)</script>", resources: ["/tmp/<img>.txt"], reason: "auto" }],
    })

    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<img>")
    expect(html).toMatch(/&lt;script(?:>|&gt;)alert\(1\)&lt;\/script(?:>|&gt;)/)
    expect(html).toMatch(/\/tmp\/&lt;img(?:>|&gt;)\.txt/)
  })
})
