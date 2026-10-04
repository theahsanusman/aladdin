# Aladdin Browser

Camoufox is Aladdin's default local browser. It always opens a visible GUI window. The human and Aladdin use the same persistent profile; open `/Applications/Aladdin Browser.app` and sign in manually once. Closing and reopening a profile preserves cookies and local storage.

The current user preference is to work only in `default`, including site tests. The app icon opens `default`, tool arguments default to it, and Aladdin's live MCP instructions require it until the human explicitly changes that preference. Other existing profiles are retained.

The `camoufox_*` MCP tools are allowed for routine browser use. Chrome's existing `--autoConnect` configuration is preserved and its MCP tools remain available as a secondary option. The official Chrome DevTools server does not attach to Chrome during MCP initialization or tool discovery; attachment starts when a browser tool is invoked. Aladdin's browser instructions permit those tools only for an explicit human request to use Chrome or the main browser. Camoufox remains the default, with no automatic Chrome fallback. Chrome may require its own one-time sharing approval.

## Profiles and tools

If multiple profiles are wanted later, explicitly change the default-only preference, then ask Aladdin to create or open a named profile through `camoufox_profiles`. Names use lowercase letters, numbers, `_` or `-`, up to 40 characters. Each profile has separate login state and one persisted fingerprint preset. Keep the same profile for the same accounts.

Tools support tabs, navigation, accessible snapshots, screenshots, targeted inputs, keyboard input, mouse clicks and drags, scrolling, selects, dialogs and file uploads. Actions in one profile are serialized. Multiple MCP clients share one browser service. Tab IDs expire on service restart, so list tabs again afterward.

For manual profile access, run the installed CLI:

```sh
"/opt/homebrew/opt/node@22/bin/node" \
  "$HOME/Library/Application Support/Aladdin Browser/runtime/dist/cli.js" open \
  --root "$HOME/Library/Application Support/Aladdin Browser/state" \
  --executable "$HOME/Library/Application Support/Aladdin Browser/browser/156.0.1-beta.34/Camoufox.app/Contents/MacOS/camoufox" \
  --profile default
```

Replace `default` with the desired profile name. The app icon always opens `default`.

To identify the profile in a browser window, type `about:support` in its address bar and find **Profile Folder**. The path ends in `state/profiles/<profile-name>/browser`; for example, `profiles/default/browser` identifies `default`. The current browser toolbar does not display a profile name. Manage these named profiles through Aladdin's `camoufox_profiles` tool or the CLI above.

## Installation and privacy

The installed macOS arm64 browser is the official Camoufox `156.0.1-beta.34` release. Its archive SHA-256 was checked before extraction:

```text
11cb4db64b874a15afe75abe27d545a4731140054de226cfc793e1b528d7e146
```

Dependencies are locked: `@camoufox/camoufox 0.5.7`, `playwright-core 1.62.0`, MCP SDK `1.29.0`, and `zod 4.1.8`. Installation used `npm ci --ignore-scripts`. Browser state, runtime, installation metadata and the original config backup live in `~/Library/Application Support/Aladdin Browser`. Profile directories are mode `700`; metadata, backups and the Unix control socket are mode `600`. The service uses stdio, a private Unix socket and a Firefox pipe, without an HTTP/CDP listener. Browser subprocesses receive an environment allowlist instead of AI credentials.

To reproduce this macOS arm64 installation, obtain the [official pinned archive](https://github.com/daijro/camoufox/releases/download/v156.0.1-beta.34/camoufox-156.0.1-beta.34-mac.arm64.zip), verify the hash above before extraction, and place its `Camoufox.app` under the versioned `browser` directory. Build this package with the commands below and copy `dist`, locked production dependencies and `package.json` into the private `runtime` directory. Node 22.15 or newer is required.

The human launcher is built from `native/launcher.swift` with `swiftc`. Its `.app` bundle uses `native/Info.plist`, the compiled executable at `Contents/MacOS/aladdin-browser`, and the pinned browser's icon at `Contents/Resources/browser.icns`. Register it with macOS Launch Services and `mdimport`. The private `installation.json` must contain absolute `node`, `entry`, `root`, `executable` and `app` paths matching that installation, plus the browser version and hashes. The CLI's `configure --config /absolute/path/to/opencode.json --root /absolute/private/state --executable /absolute/browser/executable` command backs up and updates an existing JSON config; pass these arguments after the CLI entry path. Refresh Aladdin's MCP connection afterward. Do not copy login profiles, private config backups or installation credentials into Git.

Chrome profiles are never imported. No proxy, CAPTCHA solver or cloud browser service is configured. Telemetry and automatic crash uploads are disabled. Camera, microphone and geolocation permissions default to deny. The browser keeps signed-in cookies but does not save passwords through its password manager. Profile files contain sensitive login state protected by macOS file permissions; this integration does not add encryption.

For the existing local Chrome DevTools MCP, configuration disables usage statistics, periodic update checks and the performance tool's external CrUX queries. Its original auto-connect command and unrelated environment settings are preserved.

Downloads remain in each profile's private `downloads` directory. Uploads accept only named files in that profile's private `uploads` directory, rejecting traversal and symlinks. There is no tool for arbitrary JavaScript execution, cookie export or local-file navigation. Password values are redacted from accessible snapshots; screenshots can show private content. Page content and screenshots used by Aladdin are sent to its configured AI provider.

Camoufox is a Firefox fork with fingerprint controls, not a guarantee that any site will accept automation. Account behavior, IP reputation and site policies still matter. MFA and CAPTCHA can require human action in the visible window. The installed release has a beta version label and is not Apple notarized. No Gatekeeper, quarantine, TLS or browser sandbox bypass was applied.

## Development verification

Run from this directory, not the repository root:

```sh
npm ci --ignore-scripts
bun typecheck
bun run build
ALADDIN_CAMOUFOX_ENTRY="$PWD/dist/cli.js" \
  ALADDIN_CAMOUFOX_NODE=/opt/homebrew/opt/node@22/bin/node \
  bun test ./test --timeout 30000
ALADDIN_CAMOUFOX_EXECUTABLE="$HOME/Library/Application Support/Aladdin Browser/browser/156.0.1-beta.34/Camoufox.app/Contents/MacOS/camoufox" \
  bun test ./verification/browser.test.ts --timeout 120000
```

The GUI verification uses disposable profiles and a local test page. It checks persistent login markers and identity, profile isolation, password redaction, clicks, focused typing, restricted uploads and PNG screenshots. It does not claim acceptance by LinkedIn, Meta or other account services.

The optional `verification/chrome-lazy.test.ts` runs the installed official Chrome DevTools MCP against a disposable local HTTP endpoint. Set `ALADDIN_CHROME_DEVTOOLS_ENTRY` to that server's installed JavaScript entry and `ALADDIN_CAMOUFOX_NODE` to Node 22, then run `bun test ./verification/chrome-lazy.test.ts --timeout 30000`. It verifies that initialization and tool listing do not contact a browser, and that a browser tool call starts connection attempts. It does not attach to personal Chrome.

## Recovery

Closing a browser window keeps its profile. Opening it again through the app or profiles tool restarts the browser when needed. A kernel-backed service lock prevents simultaneous brokers from owning a profile and releases when its process exits.

The original global configuration is backed up under `state/config-backups`. Review that backup before any rollback because it includes the previous Chrome auto-connect setting and may include private provider configuration. Disable Camoufox through Aladdin's MCP settings to stop agent access; stopping the integration must not trigger Chrome browser calls as a fallback. Preserve the private `state/profiles` directory if uninstalling and retaining signed-in accounts.
