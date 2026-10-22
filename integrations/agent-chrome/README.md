# Agent Chrome

Standard Google Chrome is the default automation browser. Its entire persistent user-data directory is `~/.agent-chrome`, separate from every profile in personal Chrome. The directory is private (mode `700`); no personal Chrome data is imported or copied.

Double-click `~/Start Agent Chrome.command`, or run it in Terminal. The agent can use the same launcher without asking for browser access. Chrome Sync is disabled with `--disable-sync`; website sign-ins to secondary accounts remain available. Log in manually once inside the **Agent Chrome** window. Its persistent directory retains cookies, local storage and tabs; macOS must permit Chrome to decrypt its saved sign-in. A website can still revoke or expire its own sessions.

**Agent Chrome.app** contains a private copy of standard Chrome with its own application identity and the blue icon supplied by the user. The running browser appears under that same Dock icon. Personal Chrome's app is unchanged. Clicking the icon opens or activates Agent Chrome without a Terminal window. Both the Dock app and MCP use the same fixed isolation flags and `~/.agent-chrome` data directory. The original Google account metadata and encrypted sign-in records stay in that directory.

The new application identity requires a one-time macOS approval to use the existing **Chrome Safe Storage** encryption item. Chrome uses this shared keychain item to decrypt saved browser data; approving it does not approve the whole keychain or change the MCP endpoint. The human must enter the Mac login password only in the macOS dialog and choose **Always Allow** to reuse the existing encrypted Agent Chrome session. Never read, export, delete, replace, or log that keychain item. Denying its use can prevent the saved sign-in from loading. No encryption bypass or mock keychain is enabled.

The native launcher and browser share the same certificate-backed designated signing requirement. Different ad-hoc hashes can make macOS keep asking for approval after the launcher executes the browser. The installer keeps one private local signing identity in `~/Library/Application Support/Agent Chrome/automation/signing`; its password belongs to that build keychain and is generated automatically. Never ask the user to enter a Mac password into an **identity** build-keychain prompt. Trusting this certificate for code signing requires explicit human authorization; it must not gain website/TLS trust. Rebuilds reuse the same certificate rather than generating a new identity. The build keychain is added to the existing search list only during signing; the original list is restored even if signing fails. The signing helper does not read browser keys or change the browser's encryption keychain settings.

Build the app with `python3 install-dock.py --stage '/tmp/Agent Chrome.app'`. Close only the verified Agent Chrome before updating its bundle, then run `python3 install-dock.py --install '/tmp/Agent Chrome.app'`. The installer rebuilds only its own Dock shortcut, preserves other entries, and saves a private compressed app rollback and preferences backup. Rollback archives are not registered or launchable apps. A successful installation removes its temporary staged copy. It refreshes the bookmark and icon cache and verifies persistence after a Dock restart. The single installed app lives at `~/Applications/Agent Chrome.app`; its browser executable is checked before CDP access. The supplied artwork is `assets/agent-chrome-icon.png`. Rebuild this private copy after updating the original Chrome so its browser version stays current.

OpenCode's `chrome-devtools` MCP uses the installed official server, version `1.10.1`, with `--browserUrl http://127.0.0.1:9222`. The wrapper first starts or validates Agent Chrome, checks the port's owning Chrome process and exact data-directory flags, and rejects other listeners. It never uses `--autoConnect`, browser discovery or another browser endpoint. Remote debugging listens only on IPv4 loopback. Usage statistics, update checks and external CrUX requests remain disabled. The connection needs no Chrome browser-sharing prompt.

Simultaneous MCP connections share a startup lock until the browser's verified endpoint is ready. Only the lock holder launches the app; later connections reuse that browser. The native launch mode is preserved so macOS still opens the first window. Run `python3 -B -m unittest -v test_launcher.py` from `integrations/agent-chrome` in the source checkout to check startup concurrency, browser reuse, failure recovery and listener isolation.

Routine use of `chrome-devtools_*` is allowed. If the browser was closed while the MCP remained connected, run `~/Start Agent Chrome.command`, then retry the browser tool. Closing Agent Chrome must target only the verified dedicated browser; never quit Google Chrome by application name because personal Chrome may also be running.

Personal Chrome is outside this automation path: never inspect its profiles, cookies, credentials, sessions or tabs. A future explicit request to use personal Chrome requires a separately authorized path; this connector must remain restricted to Agent Chrome. Camoufox remains installed with its saved profiles, but its MCP is disabled by default. Enable or use it only after an explicit human request.

Inspect the dedicated browser's sign-in status without exposing account identifiers, tokens or cookie values:

```sh
/opt/homebrew/opt/node@22/bin/node verify-session.mjs --inspect
```

After completing macOS keychain approval, verify the same Google account and a temporary authenticated cookie across two graceful restarts:

```sh
/opt/homebrew/opt/node@22/bin/node verify-session.mjs --restart
```

This check uses only Agent Chrome. It confirms successful credential decryption, disabled Sync, persistent local storage and the real official MCP connection. Results are saved in `session-verification.json`. A missing sign-in or authentication error fails verification; sign in manually with the secondary account if Google has revoked the old session.

The original full isolation verification is available only when the human explicitly authorizes opening harmless test windows in personal Chrome:

```sh
/opt/homebrew/opt/node@22/bin/node verify.mjs
```

That check uses Agent Chrome and a temporary localhost test site. It also opens harmless known test URLs in normal, incognito and guest-profile windows through Chrome's OS launcher, then proves none are visible through MCP. It never connects to personal Chrome or reads its tabs or account data. Its original result is retained in `verification.json`; routine repairs use `verify-session.mjs` without opening personal Chrome.

Personal Chrome's old `devtools.remote_debugging.user-enabled` browser-sharing setting was switched off while that browser was closed. The normal instance was then tested without debugging flags. The dedicated Chrome uses its explicit loopback debugging port and needs no browser-sharing approval.

The installed scripts live in `~/Library/Application Support/Agent Chrome/automation`. OpenCode configuration and agent instructions are updated without rebuilding Aladdin. Original files are backed up privately in that automation directory; never restore an old browser setting that enables auto-connect.
