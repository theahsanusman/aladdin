import { describe, expect, test } from "bun:test"
import { OauthCallbackPage } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("brands callback pages as Aladdin", () => {
    const ok = OauthCallbackPage.success({ provider: "xAI" })
    expect(ok).toContain("Aladdin is now connected to xAI.")
    expect(ok).toContain('aria-label="Aladdin"')
    expect(ok).toContain("· Aladdin</title>")
    expect(ok).not.toContain("OpenCode")

    expect(OauthCallbackPage.success()).toContain("Aladdin is now authorized.")

    const failed = OauthCallbackPage.error("boom")
    expect(failed).toContain("Aladdin couldn't complete authorization.")
    expect(failed).toContain("Close this window and try again from Aladdin.")
    expect(failed).not.toContain("OpenCode")

    const boot = OauthCallbackPage.bootstrap({ tokenPath: "/token" })
    expect(boot).not.toContain("OpenCode")
  })

  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })
})
