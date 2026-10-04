# Installation verification, 2026-10-04

- Official macOS arm64 Camoufox `156.0.1-beta.34` archive verified against SHA-256 `11cb4db64b874a15afe75abe27d545a4731140054de226cfc793e1b528d7e146` before extraction. The downloaded archive was removed after installation.
- Dependencies installed with lifecycle scripts disabled; npm audit reported zero vulnerabilities at installation.
- Final package build, type check, formatting check and `git diff --check` passed.
- Unit and integration suite: 16 tests passed, 65 assertions. Real installed Node stdio MCP verification: one test passed, eight assertions, with two clients sharing the service.
- Real GUI browser verification: one test passed, 12 assertions. It checked cookies and local storage across reopen, stable identity, profile isolation, password redaction, clicks, focused typing, uploads and PNG screenshots on a local test page with disposable profiles.
- Sixteen simultaneous startup pairs succeeded after fixing SQLite constructor lock contention.
- Native window inventory confirmed Camoufox on screen at 1280 × 1019 pixels. The app icon opens the shared default profile. Spotlight returned `/Applications/Aladdin Browser.app` after Launch Services registration and metadata import.
- Live Aladdin MCP status in the existing project and a separate directory: Camoufox connected, Chrome disabled. The Michael agent had `camoufox_*:allow`. Provider configuration and unrelated permissions were preserved. The final MCP command uses the stable Homebrew Node 22 path.
- Old inactive Aladdin backup bundles were deleted at the human's request. The active application's ASAR hash remained `dc770fd90d3cdfc5c108cad460421b63f6a4a8f936dd0033c2ed6139a66c5453` before and after cleanup.

This proves the local integration and GUI behavior. It does not prove acceptance by any social platform or guarantee CAPTCHA avoidance. The upstream browser is not Apple notarized; no Gatekeeper or quarantine override was applied. Native screen capture could not be obtained, so window visibility was verified from the macOS window inventory and browser content screenshots from Playwright.
