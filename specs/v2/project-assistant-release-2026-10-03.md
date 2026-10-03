# Aladdin verification record — 2026-10-03

## Scope and status

Recover the existing Analytics and agency chats, implement a root chat with at most three detached workers per chat, and expose the shared chat controls to a browser on the same Wi-Fi. No commit, push, deployment or user-app restart was performed. The final Michael build is installed. Normal activation of that build, a physical phone check and an elapsed 24-hour soak remain unverified. The final-build section below supersedes earlier package hashes and implementation receipts.

Unlazy Tree 3 has four leaves, each using the original 45-minute whole-task budget: existing-chat recovery; cleanup and desktop parity; detached-worker admission and interactions; lifecycle, coding, UI and release verification. Iterative review found and repaired empty provider replay, missing project placement, process cleanup races, stale host registrations after reload, short-lived PTY events, missing worker notices and cramped phone controls.

## Verified behavior

- Both original chats returned `Chat is responsive.` on the updated independent backend using their existing Michael/MiMo selection. Analytics was reconnected durably to `/Users/ahsan/Dev/biodata-for-marriage`; the agency chat used built-in compaction. Earlier transcripts remain preserved.
- Empty stop responses produce persisted visible errors. Three consecutive empty unknown turns stop. Missing project folders fail before provider invocation with an actionable error.
- Tests cover three slots per root chat, FIFO admission, cross-chat isolation, exact retries, durable settlement and interaction fencing, cancellation, V1/V2 execution and isolated coding workspaces.
- A live MiMo report worker presented its actual report in native verification. Its root Dispatcher responded while the worker waited. Submitting a checked synthetic report completed the worker and released its slot without refreshing the browser.
- A real HTTP flow completed a worker, called `/global/dispose`, and completed another worker without restarting the backend. Idle reloads do not permanently shut down the task host. Live ownership still blocks incompatible reloads.
- Browser inspection at 390 × 844 verified reachable send controls and a scrollable model/permission toolbar. Result cards display the report and individual checks. Browser error capture for the worker flow was empty.
- Authenticated HTTPS and explicit certificate validation pass on loopback. Certificate inspection precedes listener creation, and failure leaves no orphan listener.

## Test receipts

Logs are local temporary receipts, not committed artifacts. Counts describe the recorded runs, not an assertion that later unexecuted code paths passed.

| Check                                               | Result                                                              | Receipt                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Core full suite                                     | 1,213 passed, 0 failed                                              | `/tmp/aladdin-core-release-full.log`                                                                                          |
| App full suite                                      | 810 passed, 0 failed                                                | `/tmp/aladdin-shared-app-full.log`                                                                                            |
| Session UI suite                                    | 128 passed, 0 failed                                                | `/tmp/aladdin-session-ui-tests.log`                                                                                           |
| Backend worker, coding, prompt and HTTP integration | 75 passed, 1 skipped, 0 failed                                      | `/tmp/aladdin-reload-integration.log`                                                                                         |
| Backend full suite                                  | 3,704 passed, 22 skipped, 1 todo, 0 failed                          | `/tmp/aladdin-shared-backend-full.log`                                                                                        |
| Focused mobile suite with bounded timeout           | 30 passed, 0 failed across HTTPS, authorization, UI and Node assets | `/tmp/aladdin-shared-https-tests.log`                                                                                         |
| Real HTTP worker before/after reload                | Both completed                                                      | `/tmp/aladdin-reload-live-result.log`                                                                                         |
| Core, app and backend type checks                   | Passed                                                              | `/tmp/aladdin-core-final-typecheck.log`, `/tmp/aladdin-app-release-typecheck.log`, `/tmp/aladdin-backend-final-typecheck.log` |
| Desktop production build                            | Passed                                                              | `/tmp/aladdin-shared-final-build.log`                                                                                         |
| Updated Wi-Fi package and deep strict signature     | Passed; installed app and staged ASAR SHA-256 match                 | `/tmp/aladdin-shared-package.log`                                                                                             |
| Desktop Wi-Fi package type check                    | Passed                                                              | `/tmp/aladdin-desktop-lan-typecheck.log`                                                                                      |
| Package channel and code parity                     | Embedded channel `dev`; current task/error markers present          | `/tmp/aladdin-package-parity.log`                                                                                             |

The performance fixture had no blank, unknown or wrong samples. Stable cold median was 67.1 ms versus 68.7 ms previously; hot median was 73.4 ms versus 51.1 ms previously. This is fixture evidence, not live-provider latency or proof of a multi-day soak.

## Same-Wi-Fi operation

Use the existing Aladdin mobile-access settings to enable the password-protected HTTPS listener and use the displayed Wi-Fi address, normally port 47820. The Mac must remain awake and on the same network. This is the same backend and chat state, not a separate remote agent system. Use the settings' certificate instructions to trust the local CA on the client; browser-generated certificate warnings require user handling.

The actual packaged Electron Node backend returned the same synthetic chat through `127.0.0.1` and the Wi-Fi address `192.168.100.15:47820` after the user allowed Electron's firewall prompt. Trusted-CA TLS with hostname verification, authenticated API requests, pairing-cookie requests and bundled web assets passed. Python's additional X509_STRICT mode rejected the existing certificate for missing Authority Key Identifier; ordinary trusted-CA verification passed. This receipt does not establish stricter certificate-profile compatibility or a physical phone test.

The browser showed `SHARED_BROWSER_READY` live after a prompt admitted through the packaged backend. Reload retained browser authentication. Fresh browser chat discovery no longer depends on device-local opened-project preferences. The installed app contains 951 bundled web assets, channel `dev`, the browser-cookie authorization and saved Wi-Fi preference code, local-network purpose text and `_http._tcp` Bonjour metadata.

The signed build was installed at `/Applications/Aladdin.app` while closed, without launching it. Its ASAR SHA-256 matches the staged build: `fdd075eecc9bfca45c24827e1f810d6b21637c450f969e6c61d8328634ff7559`. A rollback copy is at `packages/desktop/dist/backups/Aladdin-20261003-033543.app`. The independent Electron test host was stopped before normal app activation to release the shared Wi-Fi port.

## Remaining gates and honest quality assessment

| Dimension                                            | Score | Evidence or missing gate                                                                                           |
| ---------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| Existing-chat recovery on updated backend            | 9/10  | Both original sessions replied; original Mac tabs still need activation/retest                                     |
| Bounded worker admission, isolation and lifecycle    | 9/10  | Full core suite, targeted integration and live before/after reload                                                 |
| Browser worker controls and narrow layout            | 9/10  | Native verification completed, immediate notices, phone-width inspection                                           |
| Desktop activation and shared LAN control            | 8/10  | Signed app installed; actual packaged LAN requests pass; normal Mac activation and physical phone still unverified |
| Long-running and full original architecture coverage | 6/10  | No elapsed 24-hour soak; wider design gates below remain                                                           |

Do not claim this task complete or every dimension production quality yet. Open the installed build normally at `/Applications/Aladdin.app`, retest both original Mac chats, then verify the displayed HTTPS address from a second device on the same Wi-Fi. Repository instructions prohibit agent-driven app/server restarts. Record the actual elapsed soak and failures before claiming 24/7 reliability.

The implemented worker contract is bounded: report, read-oriented research and isolated coding with human verification. The wider design still requires provider-wide priority/backpressure, safe checkpoint continuation, hostile concurrent filesystem/fault matrices and unrestricted model shell/browser verification. Those requirements remain explicit in the design rather than silently being called finished.

The user explicitly excluded the spending-cap feature on 2026-10-03. It is not a remaining release requirement. No cost policy was invented.

## Final Michael build and follow-up corrections

The executing Michael Lead assistant message is authoritative for the worker's provider, model and reasoning variant. Both V1 and V2 task tools force the Michael worker agent and copy that saved turn, ignoring requested worker model overrides. An omitted reasoning variant is recorded as `default`, so an agent's configured variant cannot silently replace the lead's selection. Manual dispatch from a lead chat uses its saved selection and rejects a missing model. Accepted tasks and explicit retries preserve their immutable execution snapshot; a subsequent fresh dispatch uses a changed lead selection.

Desktop web credentials now persist privately instead of changing on each launch. Localhost and Wi-Fi share the same credential. Password-derived browser cookies expire after 30 days and a password reset invalidates them. Desktop startup enables Wi-Fi on HTTPS port 47820 by default, while preserving an explicit disable preference. Settings displays separate Mac and phone connection links; an actual browser check caught the public response schema removing the Mac link, and a failing HTTPS API regression test now covers that boundary.

Root worker results render directly from the durable ledger in the main chat, without inventing a lead response or spending another model turn. Focus, reconnect and bounded polling restore missed updates. Result delivery no longer forces the Workers panel open over the report. Explicit retry uses generation fencing and requires confirmation for legacy or side-effect-bearing interrupted work. Known live worker hosts are protected. Unexpected desktop sidecar exits receive bounded recovery; quitting cancels startup/backoff and joins shutdown. The Mac keeps an app-suspension blocker while on AC power; this does not establish closed-lid operation.

A final migration review found that retry could resurrect the immutable Build profile of a pre-Michael task. The Michael Lead retry endpoint now rejects that profile with an instruction to dispatch a fresh Michael task. Its retry and recovery controls are hidden in the lead's Workers panel; valid Michael tasks retain them. The HTTP regression failed with an unexpected 200 before the guard and passes afterward. Browser inspection with one synthetic failed Build task and one failed Michael task verified that only the Michael task offers Retry. Historical task briefs are preserved rather than silently rewritten.

The remaining Dubai task `tsk_0fee951c6001KCJeLquqxCGyxR` was explicitly recovered only after all old verification hosts had stopped. Generation 3 completed with agent `michael`, provider `commandcode`, model `xiaomi/mimo-v2.6-flash` and variant `max`. Its actual transcript contains completed `unlazy` and native `webfetch` calls to Open-Meteo. The report includes API timestamps and a three-day forecast. No unsettled worker tasks remained in the existing database after recovery. Earlier Miami and Karachi Michael recoveries were retained.

The final packaged Node backend used the existing dev database and verified all three original chats through both `https://localhost:47820` and `https://192.168.100.15:47820`. Trusted-CA hostname validation and authenticated requests passed on both addresses; anonymous access returned 401. Both connection links carried the same credential. Browser inspection verified the two access rows, persistent authentication across test-host restarts, readable root results and reachable controls at 390 × 844, with no captured console errors. Synthetic browser result fixtures prove rendering only; the Dubai transcript above supplies actual worker execution evidence.

| Final check | Recorded result | Receipt |
| --- | --- | --- |
| Core full suite | 1,221 passed, 0 failed | `/tmp/aladdin-final-core-suite.log` |
| Backend full suite | 3,710 passed, 22 skipped, 1 todo, 0 failed | `/tmp/aladdin-final-opencode-suite.log` |
| App full suite after the migration guard | 812 unit and 41 browser-condition tests passed, 0 failed | `/tmp/aladdin-final-legacy-app-suite.log` |
| Desktop full suite | 67 passed, 0 failed | `/tmp/aladdin-final-desktop-suite.log` |
| Worker/API/auth integration | 15 passed, 0 failed | `/tmp/aladdin-final-integrations.log` |
| Migration retry HTTP regression | Passed, including valid Michael recovery and refusal of the old Build profile | `/tmp/aladdin-legacy-michael-retry-green.log` |
| Public mobile response regression after the final schema correction | 7 passed, 0 failed | `/tmp/aladdin-mobile-public-green.log` |
| Locale parity | 5 passed, 0 failed | `/tmp/aladdin-locale-green.log` |
| Relevant package type checks | Passed; SDK regenerated and app/desktop/backend rechecked after the schema correction | `/tmp/aladdin-mobile-final-typecheck.log`, `/tmp/aladdin-final-sdk-app-types.log`, `/tmp/aladdin-final-sdk-desktop-types.log` |
| Final migration-guard type checks | App, server and backend passed | `/tmp/aladdin-final-legacy-app-types.log`, `/tmp/aladdin-final-legacy-server-types.log`, `/tmp/aladdin-final-legacy-backend-types.log` |
| Final production build and signed package | Passed | `/tmp/aladdin-final-legacy-build.log`, `/tmp/aladdin-final-legacy-package.log` |
| Session production benchmark | Both V1/V2 benchmarks passed; no wrong, blank or unknown samples before or after | `/tmp/aladdin-results-baseline.log`, `/tmp/aladdin-final-legacy-benchmark.log` |
| Existing database recovery and local/LAN parity | All three chats accessible; Dubai completed | `/tmp/aladdin-final-recovery-host.log` |

The core suite includes 1,200 actual ledger/driver tasks across three roots, bounded slots, settlement and restart fencing. This is accelerated endurance evidence, not 24 elapsed hours.

The final app at `/Applications/Aladdin.app` and staged package passed `codesign --verify --deep --strict`. Their ASAR SHA-256 matches: `172c4495a6aefd7975da0d485c7e30021f8f9911303040f4a1d573772e26d816`. The immediate rollback copy is `packages/desktop/dist/backups/Aladdin-20261003-060135-before-migration-guard.app`; earlier rollback copies are retained. The app was closed during installation and was not launched by the agent. Six obsolete earlier CLI/Vite test processes and all final temporary verification backends were stopped; their listeners were confirmed closed before normal activation. The final database check found zero unsettled tasks.

After quitting Aladdin normally, reset its shared web password with:

```sh
bun /Users/ahsan/Dev/aladdin/packages/desktop/scripts/reset-web-password.ts
```

That command creates a fresh private password without printing it. Open Aladdin and use the Settings copy buttons to pair each browser. The script also accepts `--password-stdin` for a user-chosen password of at least 12 characters. Localhost and phone clients use the same saved password; old browser credentials may need the new pairing link.

The implemented model/authentication/result/recovery boundaries pass their scoped checks. Installed-app activation and the physical phone workflow still need user observation. The earlier broad architecture and 24-hour gates remain explicit; no score is raised to 9 merely because packaging or accelerated tests passed.

## Restricted tool repair and isolated real-model acceptance

The agency transcript showed Michael Lead attempting `bash`, which its coordinator tool policy intentionally excludes. The repair callback renamed the failed call to `invalid`, another tool excluded by that policy, hiding the original name and validation error. The callback now preserves the SDK's original feedback when the diagnostic tool is absent. Existing case normalization still permits `Read` to recover to `read`; tool permissions are unchanged. Two actual SessionPrompt/provider-fixture regressions cover an unavailable shell call followed by a permitted read, and malformed arguments to an available tool. The unavailable-tool regression failed before the four-line fix.

The coordinator prompt and dispatch description now state the available inspection tools and valid execution fields explicitly. Research briefs omit coding paths and base revisions. Coding briefs use safe relative paths and the host captures the actual Git base. The initial real-model admission made two validation mistakes involving absolute paths and `HEAD`, then corrected them using the original errors. After the guidance update, two further ordinary-language dispatches through the backend extracted from the final signed app had zero Lead or worker tool errors. This is error recovery evidence, not a guarantee that a model can never produce a bad call.

All test work used a separate Git project, SQLite database, XDG profile and private provider-auth copy under `/private/tmp/aladdin-real-acceptance-20261003`. The real provider was CommandCode MiMo V2.6 Flash, with reasoning variant `max`. The browser observed one, two and three occupied slots, then two queued tasks while all three workers waited on native questions. The Lead remained available and replied `READY`. Answering worker questions released slots; the fourth and fifth tasks started automatically in FIFO order. All five results survived browser reload. Every actual worker assistant used `michael`, `commandcode`, `xiaomi/mimo-v2.6-flash`, `max`, and successfully called `skill` with `unlazy`, native `read` and native `question`. No production project files were modified.

Two additional tasks ran against the backend extracted from the final app's ASAR. A plain read-only audit returned the literal fixture token without a checkpoint. A Continue/Stop control task received Stop through the root browser question, returned a stopped report without the token, and released its slot. All seven attempts completed, all worker tool calls succeeded, the final two Lead turns had zero tool errors, and the dummy repository stayed clean. The machine-checked receipt is `/private/tmp/aladdin-real-acceptance-20261003/real-worker-receipt.json`; it records the three-slot maximum and FIFO claim order 1–5. The isolated provider-auth copy was used only for these tests and is excluded from Git.

| Current verification | Result | Receipt |
| --- | --- | --- |
| Restricted-tool regressions | 3 passed, 0 failed | `/tmp/aladdin-lead-tool-final.log` |
| Relevant session/agent/worker suite | 151 passed, 1 skipped, 0 failed | `/tmp/aladdin-tool-recovery-tests.log` |
| Full backend suite | 3,712 passed, 22 skipped, 1 todo, 0 failed | `/tmp/aladdin-tool-recovery-full-suite.log` |
| Backend type check and changed-file formatting | Passed | `/tmp/aladdin-tool-recovery-types.log` |
| Final desktop production build and signed package | Passed | `/tmp/aladdin-tool-recovery-final-build.log`, `/tmp/aladdin-tool-recovery-package.log` |
| Real-model browser execution | 7 completed; 3 occupied plus 2 queued; FIFO refill; Continue and Stop answers | `/private/tmp/aladdin-real-acceptance-20261003/real-worker-receipt.json` |

The updated `/Applications/Aladdin.app` was installed while closed, passed deep strict signature verification, and matches the staged package's ASAR SHA-256: `7769d6cb89a86a74cb9fa319e3faa7ae6c4bd86313511dae9c343990cc1d221d`. The immediate rollback copy is `packages/desktop/dist/backups/Aladdin-20261003-103945-before-tool-recovery.app`. The agent did not launch the installed app. The dedicated 4116/4117 verification backends stopped after task settlement. No physical phone or elapsed 24-hour reliability claim is made.

The scoped tool-recovery, real queue execution, Michael/model fidelity, test isolation and signed installation dimensions each pass at 9/10 on this evidence. Those scores do not close the earlier wider architecture gates. The user subsequently authorized committing and pushing task changes to GitHub and specified English-only scope. Unrelated translation edits, locale tooling and accidental declaration output remain outside that commit. The English worker controls and Wi-Fi access labels are included.

## Native Michael workers and current installed access update

The later native execution mode uses the full Michael tool and permission policy, including shell and configured MCP tools, while denying recursive delegation. Michael Lead inherits Michael's prompt and direct tools; admitted workers retain the lead's actual model and reasoning variant. Native interrupted work requires reviewed side effects before retry. Portable Node APIs replace Bun globals in worker workspace operations. Five isolated native MiMo V2.6 Flash/Max tasks completed with three occupied slots plus two queued tasks and FIFO refill, including an independently observed Chrome button receipt and shell/file outputs. One missing browser argument was corrected by the model; this is recovery evidence, not a zero-error guarantee. Production projects were not changed.

Later verification: core full suite 1,223 passed; app unit suite 812 passed; browser suite 42 passed. The later broad backend run was not entirely green: six failures included a Node 20 SQLite-runtime mismatch and a duplicate legacy web service. After stopping the redundant legacy listener and using Node 24 for the compiled worker test, the failure-focused run had 18 passed and one remaining occupied-port fallback timeout. A fresh full backend suite was not rerun; earlier green receipts above apply to earlier revisions. Worker question identity now remains stable across ledger polling, preserving answers and focus; the browser regression failed before that repair.

Passwordless access is an explicit local opt-out, requested by the user. Desktop startup reads the private `aladdin-web-no-password` preference and passes an empty password plus explicit LAN permission to its sidecar. New installations remain password protected; resetting the saved password removes the opt-out. This grants access to any device able to reach the listener. Targeted credential/lifecycle tests passed 11/11; mobile/auth tests passed 13/13; desktop and backend type checks passed. The rebuilt application ASAR was installed within the previously verified Electron 42.3.3 framework, its archive integrity metadata updated, then the app signed, deep-strict verified and restarted normally. Installed ASAR SHA-256: `f9996e698a1b7dd9f40f5ff0b4bd0b560146e357945db4589d62f201cc829cc4`. Rollback: `packages/desktop/dist/backups/Aladdin-before-passwordless-20261003-160919.app`.

Current HTTPS root, bundled asset, health, mobile status and both existing chat records returned 200 without an Authorization header or login challenge. The Codex browser does not trust the private certificate authority; no browser security warning was bypassed. The same live backend rendered the existing Analytics chat in a fresh browser through its loopback HTTP address, with no console errors. The redundant `ai.opencode.web` legacy launch service was stopped and disabled, leaving the app-owned loopback and phone listeners running. Physical-phone interaction is not asserted.

The original image-heavy email chat empty response is still unresolved. Focused provider/history tests passed 47/47, and a live MiMo V2.6 Flash/Max test with six harmless 923x2000 screenshots completed normally. The original history has valid local serialization, but synthetic success does not prove that private failing content works. Automatic approval review rejected replaying that private original chat and its images to Command Code without specific authorization. No speculative provider patch or removal of the empty-response guard was made. The unresolved provider failure, occupied-port timeout and elapsed soak acceptance remain open; this update does not claim universal production reliability.
