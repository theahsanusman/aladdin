# Browser readiness follow-up, 2026-10-04

## Chrome tools on explicit request

The initial installation disabled Chrome's MCP. That removed its tools entirely, so the agent could not use Chrome even after an explicit human request. The follow-up preserves the existing `--autoConnect` command and enables the official MCP's tool catalog. Browser attachment remains lazy: connecting the MCP and listing tools do not attach to Chrome.

- The real installed official Chrome DevTools MCP `1.10.1` was initialized and its tools listed against a disposable local HTTP endpoint. No browser requests occurred until `list_pages` was invoked. That invocation attempted a connection and returned the expected error because the endpoint had no browser. One test passed with seven assertions. Personal Chrome was never contacted by this verification.
- Existing provider settings, unrelated MCP entries, permissions and Chrome environment values were preserved. Usage statistics, periodic update checks and external performance CrUX queries are disabled for the existing local Chrome connector.
- Live Aladdin MCP status was verified as connected for both Camoufox and Chrome in the affected `Random Exp` workspace and the Aladdin workspace. The current Camoufox instructions are injected into each provider turn and restrict Chrome use to an explicit human request. They direct the agent to use the available tools rather than ask the human to enable the connector.
- Actual attachment to personal Chrome was not exercised. Chrome may still require its own one-time browser-sharing approval.

## Default profile and Cloudflare observation

The human requested that manual browsing and Aladdin use only `default` for now. The launcher opens `default`, omitted tool profile arguments select it, and the live MCP instructions now require it until the human explicitly changes that preference. Existing other profiles and saved login state were retained.

The earlier Aladdin test used a fresh `browser-test` profile and did not progress past the Cloudflare challenge. On this follow-up, the same public URL, `https://www.scrapingcourse.com/antibot-challenge`, was opened in the existing visible `default` profile. Its initial title was `Just a moment...`; after a five-second wait, the accessible snapshot and screenshot showed the real page with **You bypassed the Antibot challenge! :D**. The probe performed no checkbox click and installed no additional solver, proxy or browser setting. The captured [screenshot](./cloudflare-default-2026-10-04.png) contains only the public test page.

This establishes one successful run on that page. It does not establish why the earlier profile failed, a reliable pass rate, acceptance by social platforms, or universal CAPTCHA avoidance.

The launch configuration was checked against the installed TypeScript wrapper and [official usage documentation](https://camoufox.com/python/usage/): a saved real fingerprint preset matching Firefox 156, humanized cursor movement, a visible persistent context, host locale/timezone and normal WebGL remain configured. No user-agent override, request interception or proxy is added. COOP remains enabled; the main-world evaluation option remains off. The [upstream detection tracker](https://github.com/daijro/camoufox/issues/686) also records site-specific failures. The older [camoufox-captcha](https://github.com/techinz/camoufox-captcha) helper is archived and requires disabling COOP plus opening closed scope access; it was not installed.

## Final focused checks

- Package type check and build passed. Unit and real IPC/stdio MCP tests: 18 passed, zero failures, 68 assertions.
- After Aladdin reopened, Camoufox and Chrome's MCP catalogs were connected in all four checked workspaces, including the affected `Random Exp` workspace. A real stdio client verified the installed default-only instructions and all 14 tools' `default` profile argument; it invoked no browser action.
- The installed connector and private installation manifest match SHA-256 `2758d70aaaa551f7330d91e674edbf65bc05719ff47a2d4bd202d7f3289bae35`.
- Browser executable, saved profile identity, cookies and native launcher were not replaced by this follow-up. No Aladdin harness rebuild was required for the external MCP update.
- Formatting and patch whitespace checks passed before commit. This receipt supplements the initial installation record; its historical Chrome-disabled state is superseded by this follow-up.
