# Aladdin continuation handoff and remaining work

Updated: **2026-10-03**. Handoff facts reconciled at approximately 18:30 Asia/Karachi.

**22 tracked items: 20 open and 2 verified closed.** Open items include implementation, verification, release steps, and deferred decisions; this is not a count of confirmed bugs. R01–R18 retain their previous IDs. R19–R22 record the latest cleanup, layout, dispatch, and browser findings.

The user asked to stop implementation and transfer work to a new chat. This update changes documentation only. No model requests, application/source/configuration changes, database mutations, installation, restart, commit, or push were performed for this handoff.

## Start here

The immediate objective is a **usable focused release**: clean worker controls, correct task admission/status, and the same updated interface on Mac and same-Wi-Fi browsers. Deliver that release before the deferred audit.

1. Read applicable AGENTS.md files, this document, and the actual working diff. Load `unlazy`; work as Michael in one context without subagents.
2. Finish **R19, R20, R21, and R22** first. Their code implementation had not started at transfer; only a plan and an unsuccessful benchmark launch were prepared.
3. Recheck **R04, R06, R08, and R09**, plus affected tests/performance in **R10**. Preserve the passing queue/settings behavior in **R07**.
4. Run bounded MiMo Max/None dummy-project checks for **R01–R03**. Use existing evidence; do not repeat private-history requests without fresh consent. Report upstream failures rather than hiding them by changing model/effort.
5. Build/install/verify **R17**, then carefully commit/push **R18**. Update this file as gates pass.
6. Leave **R11–R16** visible for the next reliability/security/architecture phase. The user requested a usable release first, then approval for further work.

Tick an item only after its acceptance condition passes; add date, tested artifact/revision, and evidence. Keep completed entries and update counts. Source changes or unit tests alone do not close an installed-app requirement.

## Current state

An earlier focused update **was built, signed, installed, and restarted normally** at `/Applications/Aladdin.app`. It includes worker activity access, friendly cancellation messages, guarded cancellation recovery, Michael Lead composition/prompt cleanup, and detection of a truncated CommandCode Responses stream.

The latest requested Delete controls, compact layout, dispatch/status improvements, and loopback frontend fix **are not implemented or installed**. The previous focused source changes remain **uncommitted**.

| Item | Recorded value |
| --- | --- |
| Repository | `/Users/ahsan/Dev/aladdin` |
| Branch | `aladdin-fixes` |
| HEAD | `cbfa0833e67034e591ea6f7b5a96a96ec6ab5398` |
| Origin | `git@github.com-personal:theahsanusman/aladdin.git` |
| Index | No staged changes |
| Dirty/untracked files | 146 at handoff; many predate this work |
| Installed runtime | Electron 42.3.3 / Node 24.15.0 |
| Backend build version | `0.0.0-dev-202610031251` |
| Database | `/Users/ahsan/.local/share/opencode/opencode-dev.db` |
| Last verified phone URL | `https://192.168.100.15:47820/` |
| Last observed loopback | `http://127.0.0.1:55294/`; port can change on restart |
| LAN login preference | Passwordless, explicitly requested |

The last live check returned 200 for HTTPS frontend/assets, health, and mobile status, without an authorization header or login challenge. This is recorded evidence, not a guarantee that the current IP, port, or process has stayed unchanged. Recheck before giving the next phone link.

The obsolete `ai.opencode.web` launchd server on port 4096 was stopped/disabled. Do not restore it to work around the app listener.

## Constraints and authorization

- Work alone. Do not delegate or resume old subagents listed by the environment.
- English only. Do not run `translate:app` or `script/translate-app.ts`. If parity requires it, add English fallback keys only.
- **Do not edit the main Michael file.** Preserve private instructions and user edits. Improve Michael Lead through its coordination overlay while retaining Michael's base instructions and full configured tools.
- Workers must be `michael`, using the **actual executing lead turn's model and reasoning snapshot**. Never substitute build/plan/general/explore or lower Max silently.
- Test in dummy projects and isolated data. Do not modify production project files, delete real chat history, or replay interrupted side effects silently.
- The user authorized the focused build/install and normal restart, plus commit/push with the `theahsanusman` SSH identity. Check active work before activation; preserve durable state and rollback. Do not force-kill uncertain worker ownership for convenience.
- Preserve passwordless LAN access. It does not identify only the user's phone. Obtain a new decision before changing credentials, device restrictions, or firewall/router settings.
- Private email history/images were approved for two diagnostic requests, followed by two more including Michael's private instructions. **All four were used.** Further private replay needs fresh consent. Those diagnostics executed no tools and added no chat messages.
- Chrome's Allow prompt/profile access are separate permissions. Do not bypass consent or approve a pending profile permission automatically.
- No worker spending-cap feature; the user excluded it. Do not install dependencies/plugins/MCPs/skills/packages without necessity and authorization.
- Do not stage the whole dirty tree or commit private agent files, credentials, diagnostic payloads, unrelated translations, or accidental generated declarations.

## Agent and source locations

| Purpose | Location |
| --- | --- |
| Main Michael, unchanged | `/Users/ahsan/.config/opencode/agents/michael.md` |
| Effective Michael Lead file | `/Users/ahsan/.config/opencode/agents/michael-lead.md` |
| Canonical Lead overlay | `packages/opencode/src/agent/prompt/dispatcher.md` |
| Agent composition/permissions | `packages/opencode/src/agent/agent.ts` |
| Dispatch tool/schema | `packages/core/src/task/dispatch-tool.ts`; inspect the actual V1 registry too |
| Durable ledger/execution/schema | `packages/core/src/task/ledger.ts`, `execution.ts`, `sql.ts`; `packages/schema/src/task.ts` |
| Public task API | `packages/protocol/src/groups/task.ts`, `packages/server/src/handlers/task.ts` |
| Workers panel | `packages/app/src/pages/session/composer/session-worker-dock.tsx` |
| Chat worker cards | `packages/app/src/pages/session/timeline/session-worker-results.tsx` |
| Cancellation/evidence formatter | `packages/app/src/utils/worker-evidence.ts` |
| Browser coverage | `packages/app/e2e/regression/worker-inspection.spec.ts` |
| Provider stream guard | `packages/opencode/src/provider/command-code.ts`, `provider.ts` |
| Listener startup | `packages/desktop/src/main/index.ts`, `sidecar.ts`; `packages/opencode/src/aladdin/mobile.ts` |
| Architecture gates | `specs/v2/project-assistant-workers.md` |
| Historical release record | `specs/v2/project-assistant-release-2026-10-03.md` |

Main Michael SHA-256 recorded after the installed update:
`c8409ab7b6337bc2832e6769b536ceeb8dcd8919d8b1074c19e3afa99e59a052`.

Michael Lead was updated to retain Michael's instructions/tools and append one canonical `# Michael Lead role` section. Main Michael was unchanged. Do not copy either private file into GitHub or a provider payload automatically.

## What the latest Snake screenshots actually showed

- A `task_dispatch` call passed `brief` as a JSON string containing invalid JSON: parser error at position 2197. That failed call was not admission.
- The corrected next call admitted `tsk_101e120b2001451uXQuHAH6lwv`. Its initial `queued` result did not prove every worker slot was occupied.
- A Michael worker at Max did work. At the last read-only check, `/Users/ahsan/Dev/Random Exp/snake-game/index.html` existed with 17,473 bytes. Do not edit that production file for harness testing.
- Browser verification failed through Chrome MCP because `~/Library/Application Support/Google/Chrome/DevToolsActivePort` was missing; the worker then awaited a profile-directory permission.
- Last observed board: two cancelled jobs and one waiting-for-user job, queue not paused. This can change while the user works.
- The lead's claims that it lacked shell/write tools and that queued tasks necessarily meant no free slots contradicted current configuration/ledger evidence.

| Object | ID at last inspection |
| --- | --- |
| Snake root chat | `ses_efe83b57affepJkbRy9DZMPzW2` |
| Worker chat | `ses_efe1edf46ffdS99euNe04IEH0Y` |
| Cancelled job | `tsk_10180562a001vE9cQPYCRuFqBA` |
| Cancelled job | `tsk_1017d15390010PdQoDu6X25yHC` |
| Pending Chrome-directory interaction | `tin_101e91d54001ZL0jnJrg7uMhow` |

Recheck live state before acting. These IDs are for reconciliation, not permission to cancel tasks or resolve the real Chrome permission.

## Checklist: latest usability work

- [ ] **R19 — Delete cancelled workers from both views.**
  No implementation yet. Add Delete to cancelled jobs in Workers and their chat result cards. Persist dismissal server-side so removal survives reload and updates Mac/phone. Preserve project files, child transcripts, evidence, and exact-retry identity; this clears displayed jobs, not those underlying records. Reject active-job and wrong-owner removal; repeated removal must be idempotent. Test both views, reload, cross-client updates, and server error/ownership paths.

- [ ] **R20 — Compact, readable worker layout.**
  View activity currently sits below the title, persistent result/evidence details are open, and cancelled cards are bulky. Put View activity on the right of the title with other actions; keep details closed by default and cancelled cards compact. Preserve readable status, technical evidence access, and navigation fences. Verify desktop/phone widths, long titles, keyboard access, no horizontal overflow, and return to the correct root chat.

- [ ] **R21 — Correct structured dispatch and factual task status.**
  Invalid serialized briefs and unsupported queue/tool claims are observed. The schema accepts an object or `Schema.fromJsonString(Task.Brief)`; models can choose fragile double-encoded JSON. Advertise a structured brief object while retaining valid historical string compatibility where appropriate; keep strict validation and useful errors. Teach the real contract, checks, modes, engine, retries, and inherited settings. Provide a supported read-only way to inspect current owned task state when needed; `task_status` is a possible solution, not an existing tool. Do not add polling. Test model-visible schema and actual MiMo admission/status in dummy data. Never infer slot occupancy from `queued` alone.

- [ ] **R22 — Same updated bundled frontend on loopback and Wi-Fi.**
  Confirmed mismatch: desktop `index.ts` sets `OPENCODE_DISABLE_EMBEDDED_WEB_UI=true`; loopback `sidecar.ts` does not override it and proxies an older hosted frontend. Mobile explicitly passes `serveWebUI:true`. Observed loopback asset `index-B7jvntCB.js` lacked worker components; HTTPS asset `index-BU4oM9Pf.js` contained them. Make the desktop-owned loopback listener serve the current bundle through the explicit existing option. Verify current assets/features on both listeners even with that environment flag set, then inspect the exact installed browser. Do not mask this with another standalone server.

- [ ] **R04 — Finish worker activity inspection verification.**
  Implemented and installed; four browser tests passed. Job details and read-only exact-worker navigation exist. Complete wrong-owner and retry/navigation race coverage, plus new layout/removal interaction checks. Check running/completed/previous attempts, queued messaging, missing transcripts, tool/output visibility, and return to the owning chat.

- [x] **R05 — Clear cancellation messages with technical traces collapsed.**
  Verified for the installed focused update on 2026-10-03: friendly old/new cancellation formatting and browser disclosure coverage pass. The message explains that performed side effects may remain. This closes the gibberish requirement only; removal/compact presentation remain R19/R20.

- [ ] **R06 — Complete crashed-host cancellation recovery verification.**
  Guarded recovery is implemented/installed and core tests pass. It requires the old host to be stopped and side effects reviewed, settles without replay, and retains ownership when cleanup fails. Complete the rendered recovery-control/error-path check on the final build. Prove a live/uncertain host cannot be treated as dead and refill cannot duplicate effects.

- [x] **R07 — Three workers, FIFO overflow, inherited model/effort.**
  Verified with real MiMo in isolated packaged Electron/Node on 2026-10-03: Max had three native shell workers active and two queued; cancellation while paused then FIFO refill; final four completed/one cancelled. Workers were Michael with Max snapshots and skill/shell tools. Separate None lead dispatched a Michael worker inheriting None and completing. Core/HTTP tests cover isolation/fencing. Receipt: `/private/tmp/aladdin-usable-live/receipt.json`. Repeat affected regressions after new code, rather than replacing the scheduler based on an initially queued response.

- [ ] **R08 — Packaged tools and Chrome failure paths.**
  Native skill/shell execution is proven; prior Bun-global/unavailable-tool fixes exist. Real Chrome remains blocked by missing DevToolsActivePort/consent. Verify final packaged shell/read/skills/web/MCP access and distinguish invalid input, unavailable tool, permission, and connection failure. Recovery must be bounded and honest about user action; no consent bypass or endless profile probing.

- [ ] **R09 — Shared Mac/browser chats and controls.**
  HTTPS health/assets and four real chat identities/history were verified. Physical-phone control remains unverified; loopback parity needs R22. On the final build test send/resume/stop, worker activity, questions, allow/reject, queue controls, reload, and reconnect with dummy data. Confirm the same-Wi-Fi link and preserve real chats/ongoing work. HTTP 200 is not proof of every control.

- [ ] **R10 — Final regression checks and performance comparison.**
  Earlier focused checks passed below. The latest attempted baseline failed before measurements: default Node 20.17.0 is too old for installed Vite, and the runner rejected `bun:` imports. Resolve runner/toolchain, then measure before/after UI changes. Run affected ledger/API/app/browser tests, package typechecks, formatting, and build. Cover durable removal, ownership/idempotence, compact controls, dispatch schema/status, and frontend parity. The older occupied-port fallback timeout remains a broader-suite follow-up, not a fresh all-green result.

## Checklist: MiMo reliability

- [ ] **R01 — Finish empty-response reliability repair.**
  One cause is reproduced and a stream guard is installed. Full Michael plus long image-heavy history returned reasoning deltas then EOF without a terminal Responses event. The SDK formerly classified this as `finish:other` with no text, leading to repeated-empty-response errors. The new guard identifies a retryable truncated stream and retains bounded retries; it cannot force upstream completion. Verify the installed failure/recovery path and representative sanitized cases. Useful error wording alone is not answer reliability; do not discard context/change effort silently.

- [ ] **R02 — Representative MiMo V2.6 Flash Max testing.**
  Short conversation/native-worker Max tests pass. Authorized full-history/Michael replay failed after 102.103 seconds, with 121 reasoning deltas and no completed/incomplete/failed event. This does not prove reasoning continued after EOF. Test conversation/tools/images/long context with actual reasoning metadata and lead/worker fidelity. Report upstream limits rather than declaring Max reliable from short cases.

- [ ] **R03 — Representative MiMo V2.6 Flash None testing.**
  Authorized full-history/Michael replay completed after 104.264 seconds with 132,827 input tokens, zero reasoning tokens, and a completed event. Real None lead/worker also passed. User-reported interactive None failures remain insufficiently explained, so one replay success does not close reliability. Verify representative follow-ups/images/tools/long context on the installed path. Private replay consent is exhausted; use sanitized cases.

## Checklist: deferred work and decisions

- [ ] **R11 — Visible, recoverable Wi-Fi startup failure.**
  Source-backed gap: mobile restore errors are logged while the sidecar still reports backend ready. Distinguish backend/Wi-Fi readiness, show actual address/error, and support bounded bind/certificate recovery while preserving enable/disable preference. Later phase unless it blocks release.

- [ ] **R12 — Long-running backend stall/recovery handling.**
  Exit supervision/startup health do not establish ongoing detection of a live but unresponsive backend. Agree a visible stall/exhausted-recovery path; test crash/sleep/wake/cleanup and accepted-input preservation without replaying uncertain effects. Avoid speculative supervision during urgent UI work.

- [ ] **R13 — Same-Wi-Fi security review and access decision.**
  Review only until a decision: passwordless access allows any device reaching the listener, not only the user's phone. Router/public exposure was not established. Review interfaces and cross-origin mutations with isolated harmless data; CORS headers alone do not prove mutations are rejected. Obtain approval before changing authentication/devices/firewall/router settings.

- [ ] **R14 — Finish the deep harness audit.**
  Consolidate model/tool, lifecycle, LAN, desktop, and UX findings. Separate confirmed defects, intentional behavior, and hypotheses; include evidence/impact/proposed action. Focused checks cannot establish whole-system production readiness.

- [ ] **R15 — Actual elapsed 24-hour soak.**
  Deferred/unverified. Use dummy data and bounded provider activity; record start/end, task churn/slots, results/interactions, resource growth, sleep/wake, and failures. Accelerated tests are not 24 elapsed hours. Do not block the urgent release pretending this has already passed.

- [ ] **R16 — Wider architecture gate reconciliation.**
  Map `project-assistant-workers.md` gates to proof, missing work, or explicit deferral, including provider backpressure, safe checkpoint continuation, and concurrent filesystem/fault testing. Three-worker success does not prove restart-safe arbitrary side effects. Keep the excluded cost cap out of scope.

## Checklist: release and GitHub

- [ ] **R17 — Next focused Mac build, installation, activation, verification.**
  Earlier focused release is installed; R19–R22 require a new build. Finish urgent changes/checks, preserve `dev` database channel/rollback, sign and identify the installed artifact, activate normally with work preserved, and verify both listeners/UI/task controls/history/health/phone URL. State unresolved MiMo, Chrome, and physical-phone limits plainly.

- [ ] **R18 — Commit and push intended changes.**
  Authorized and pending. Stage intended code/tests/generated-contract changes/docs only; use a conventional commit and the personal SSH identity. Exclude private payloads/agents/secrets, temporary probes, accidental declarations, and unrelated translations. Verify exact remote commit identity and update the tracker.

## Existing evidence: reuse, then extend for the final diff

These receipts apply to the earlier focused worktree/build, not future code:

| Check | Recorded result | Receipt |
| --- | --- | --- |
| Core task tests | 64 passed, 0 failed, 6 files | `/tmp/aladdin-usable-core-tests.log` |
| Targeted backend tests | 106 passed, 0 failed, 8 files | `/tmp/aladdin-usable-opencode-tests.log` |
| Provider/prompt integration | 191 passed, 1 existing V2-projector-disabled skip, 0 failed | `/tmp/aladdin-usable-provider-integration.log` |
| App unit suite | 813 passed, 0 failed | `/tmp/aladdin-usable-app-unit2.log` |
| Worker browser tests | 4 passed: desktop/phone inspection, missing activity, cancellation disclosure | `/tmp/aladdin-usable-worker-ui2.log` |
| Package typechecks | Core, opencode, app, desktop passed | `/tmp/aladdin-usable-<package>-typecheck.log` |
| Production build | Passed | `/tmp/aladdin-usable-final-build.log` |
| Real MiMo packaged flow | Max three-active/two-queued/cancel/FIFO; None dispatch/worker passed | `/private/tmp/aladdin-usable-live/receipt.json` |
| Installed HTTPS check | Health/assets, no challenge, preserved four chats | `/private/tmp/aladdin-usable-package/live-receipt.json` |

Production tab-switch benchmark, five cold/five hot samples: median first correct content **30.1 ms cold / 1.9 ms hot**, median stable **48.7 ms cold / 53.8 ms hot**, zero wrong/blank samples. Receipt: `/tmp/aladdin-usable-benchmark-after.log`. Earlier baseline: `/tmp/aladdin-worker-activity-benchmark-before.log`. Latest failed launch: `/tmp/aladdin-worker-final-benchmark-before.log`.

Private diagnostic metadata receipts: `/private/tmp/aladdin-usable-probe/history-receipt.json` and `history-michael-receipt.json`. Zero tools/messages were executed/added. Do not print or commit underlying private payloads.

Temporary receipts can disappear. Preserve necessary non-sensitive final evidence in `specs/v2/project-assistant-release-2026-10-03.md`. Historical paragraphs describing pending tests/approvals may predate the successful focused release; reconcile dates instead of blindly repeating every test.

## Implementation and verification notes

**Durable removal:** prefer a soft-dismissal field with a proper migration. Hide dismissed cancelled jobs from board/list/counts and owning views; retain records/evidence/child chat/exact retries. Enforce owner/state/idempotence on the server and publish task-change notification for other clients. Add a scoped endpoint/client method if needed.

Useful real tests: `packages/core/test/task-ledger.test.ts`, `task-ledger-migration.test.ts`; `packages/opencode/test/server/httpapi-task.test.ts`; `packages/app/e2e/regression/worker-inspection.spec.ts`. Mock UI fixtures do not replace real database/API persistence proof.

Use the core migration generator. After public Protocol/HttpApi changes, run `bun run generate` in `packages/client`; never hand-edit generated clients. Preserve Schema → Core/Protocol → Server dependency direction.

**Dispatch:** do not repair malformed JSON by admitting arbitrary data. Advertise the object schema and keep strict decoding. Legacy `tool/tool.ts` supports a JSON-schema override; inspect both registration paths. Do not change a real chat's engine to make dispatch succeed. Preserve host-pinned agent/model/effort.

**Activity:** current navigation captures root/task/attempt/session identities and rechecks them after async lookup. Preserve those fences. Keep evidence accessible but collapsed. Delete is opt-in; do not destructively auto-clear old jobs.

**Tests:** run from package directories, not repo root. Entry points to extend:

```sh
# packages/core
bun test test/task-ledger.test.ts test/task-execution.test.ts test/task-ledger-migration.test.ts
bun typecheck

# packages/opencode
bun test test/provider/command-code.test.ts test/agent/agent.test.ts test/task-dispatch-parameters.test.ts test/server/httpapi-task.test.ts
bun typecheck

# packages/app
bun run test:unit
bun typecheck
# Browser target: e2e/regression/worker-inspection.spec.ts
# Production benchmark: e2e/performance/timeline/session-tab-switch-benchmark.spec.ts
# Config: e2e/performance/playwright.config.ts
# Resolve compatible runner first; latest benchmark launch failed before measurement.

# packages/client, when public contracts change
bun run generate
bun typecheck

# packages/desktop
bun typecheck
```

Read `packages/app/e2e/AGENTS.md` and its required official Playwright guides before editing E2E. Use scoped exact locators/state assertions, no arbitrary waits or repeated mutations. Inspect rendered browser-facing changes in the Codex in-app browser where available. Narrow-width automation is not a physical-iPhone test.

## Build and installation handoff

`packages/desktop/scripts/prebuild.ts` already sets `OPENCODE_CHANNEL` after channel resolution. Keep it `dev`; a branch-derived channel can hide existing chats by opening another database.

Default Node 20.17.0 failed the installed Vite requirement. Use the compatible existing Node toolchain; prior build used Node 22 and cached models. Do not install a new runtime/dependency without authorization.

Standard entry points from `packages/desktop`:

```sh
OPENCODE_CHANNEL=dev MODELS_DEV_API_JSON="$HOME/.cache/opencode/models.json" bun run build
bun run package:aladdin
```

Set PATH/`ALADDIN_BUILD_NODE` to the verified compatible existing Node if needed. Inspect `scripts/package-aladdin.mjs`; it signs nested helpers/frameworks and verifies the bundle. Build proof is not installation proof.

Previous staged replacement helpers: `/private/tmp/aladdin-usable-package/package.mjs` and `install.py`. They preserve installed Electron/native dependencies while replacing built ASAR/CLI. Inspect/update paths, outputs, marker checks, and receipts before reuse; stale staging is not a new build. Preserve normal quit, rollback, signature checks, Electron ASAR integrity metadata, and login preference.

- Installed focused ASAR SHA-256: `59763da142ec0d3f06a3354ce7e1f9740ffb4c579ab3f7dbc704ca1c6c5b069b`.
- Rollback: `/Users/ahsan/Dev/aladdin/packages/desktop/dist/backups/Aladdin-before-usable-20261003-180138.app`.
- Recorded signer: `Apple Development: Ahsan Usman (2KG65UJYX2)`.
- Previous deep/strict signature verification passed with host trust-store access. A sandbox trust-store error alone is not proof of a bad installed signature.
- Password opt-out: `~/Library/Application Support/ai.opencode.desktop.dev/aladdin-web-no-password`, contents `disabled`, mode 0600. Preserve it.
- Prior HTTPS check verified hostname/trust with the existing local CA while clearing strict X509 validation because the CA lacks AKI. It was not a physical-phone test. Never publish private certificate keys/credentials.

Check live statuses/ownership before controlled activation. Do not assume the app is still closed because of an earlier message.

## Git ownership and staging

Focused work currently modifies worker dock/results, worker-evidence implementation/test, the new worker browser spec, core execution/test, agent composition/overlay/tests, and CommandCode provider/adapter/tests. Fifteen `session.workers.*` English/fallback keys coexist with much larger pre-existing locale edits.

Unrelated pre-existing changes include `packages/ui/src/i18n/*`, large app locale edits, app `desktop-native*`/`parity.test.ts`, and `script/translate-app.ts`. Untracked client `src/generated/*.d.ts` and `src/index.d.ts` are not intended additions.

Baseline ownership snapshot: `/tmp/aladdin-worker-activity-before-git.json`. Documentation-only snapshot: `/private/tmp/aladdin-document-handoff-before.json`.

Stage paths/hunks deliberately. For mixed dictionaries, stage only owned English fallback additions. New generated TypeScript contract changes from the required generator are legitimate if reviewed. Inspect cached diff for scope/secrets.

Origin uses `github.com-personal`; previously verified account was `theahsanusman`, configured through `~/.ssh/personal_g` with identities-only SSH. Recheck metadata/remote before pushing; do not print key contents. Use a conventional commit and verify the remote commit.

## Real chat identities to preserve

Message counts below were verified after the focused installation and can grow. Preserve identity/history, not frozen counts.

| Chat | Session | Directory | Recorded messages |
| --- | --- | --- | --- |
| Connecting Google Analytics & Search Console via MCP | `ses_f1f13e6e7ffebQJ6P1EGF7OVjP` | `/Users/ahsan/Dev/biodata-for-marriage` | 2,990 |
| Email delivery failure to natixis.com | `ses_f089a2092ffey57bQhSI00N22t` | `/Users/ahsan/Dev/QBIG` | 154 |
| Dev server on 3001 and agency site context review | `ses_f0232cd57ffeFtJ4kyp8SBeA80` | `/Users/ahsan/Dev/unicornx` | 221 |
| Old school snake game creation | `ses_efe83b57affepJkbRy9DZMPzW2` | `/Users/ahsan/Dev/Random Exp` | 25 |

## Final release gate and copyable new-chat prompt

The focused release requires requested cleanup/layout, truthful tested task admission/status, current UI on both listeners, relevant tests/build, exact installed-app verification, and intended changes confirmed on GitHub. Record provider/Chrome/physical-phone limits honestly. Deferred R11–R16 remain open; do not score the whole unverified system as perfect.

Open a new chat in `/Users/ahsan/Dev/aladdin` and paste:

```text
Read /Users/ahsan/Dev/aladdin/specs/v2/aladdin-remaining-work.md and applicable AGENTS.md files. Take over the focused usability release there. Work as Michael alone, use Unlazy Tree 3, and preserve production folders/chats, main Michael instructions, and unrelated dirty changes.

Start with R19–R22: persistent Delete for cancelled jobs in both views, compact worker layout with View activity on the right, correct structured dispatch/factual task status, and identical bundled frontend on loopback/Wi-Fi. Reuse the installed fixes and receipts; do not start from scratch. Test affected behavior in dummy projects with MiMo V2.6 Flash at Max and None. Private email history/images and private agent instructions need fresh consent before further provider replay.

Finish relevant verification, build/install with the dev database preserved, activate normally with current work handled safely, and verify browser/LAN access. Commit/push only intended changes using the theahsanusman SSH identity. Keep the Markdown checklist updated with evidence; give me the working phone link and verified release/Git result. Deliver this focused release first; leave R11–R16 for later approval. Be honest about unresolved upstream MiMo/Chrome-consent limits, and ask only for genuinely missing decisions.
```
