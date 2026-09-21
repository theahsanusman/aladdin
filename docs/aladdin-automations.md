# Aladdin Automations

Scheduled, unattended agent runs modeled on the Codex app's "Scheduled tasks", plus the
supporting harness pieces: permission profiles, budgets, file claims, and a verification gate.

Status: implementing (this doc is the frozen contract for the build).

## Concept map (Codex -> Aladdin)

| Codex | Aladdin |
| --- | --- |
| Standalone automation (new chat per run) | Automation `kind: "standalone"` creates a new session per run |
| Automation in a chat (returns to same chat) | Automation `kind: "thread"` targets an existing session |
| Scheduled view / inbox | Automations page: automations + runs with unread indicator |
| Run in project dir or worktree | Runs in the project directory. Worktrees are out of scope; a file-claim registry prevents write collisions instead |
| Default sandbox + `approval_policy = never` | Per-automation permission profile compiled into a session ruleset; unattended runs never prompt |
| Skills in prompts | Plain prompt text; skills can be referenced by name |
| Model + reasoning effort | Optional `agent` and `model` per automation, defaulting to the user's defaults |
| RRULE advanced schedule | `interval` / `daily` / `weekly` / `monthly` / `cron` schedule union |
| Machine on + app running | Server process must be running (desktop app open). Missed runs are skipped, not caught up |

## Data model

New tables in `packages/core/src/automation/sql.ts` (one migration).

### `automation`

| column | type | notes |
| --- | --- | --- |
| `id` | text PK | `atm_...` |
| `project_id` | text FK -> `project.id` cascade | resolved from `directory` |
| `directory` | text | absolute project directory |
| `name` | text | display name |
| `prompt` | text | the saved prompt |
| `kind` | text | `standalone` \| `thread` |
| `target_session_id` | text nullable | required for `thread` |
| `agent` | text nullable | agent name; NULL = default agent |
| `model_provider_id` / `model_id` | text nullable | external model ref; NULL = default model |
| `profile` | text | `read-only` \| `workspace-write` \| `full` (default `workspace-write`) |
| `schedule` | json | `Schedule` union below |
| `verification` | json | `VerificationCheck[]` (`{ command, timeout_seconds? }`) |
| `budget_per_run_tokens` | integer nullable | hard per-run cap |
| `budget_per_day_tokens` | integer nullable | hard per-automation daily cap |
| `timeout_minutes` | integer | wall clock cap, default 30 |
| `status` | text | `active` \| `paused` |
| `next_run_at` | integer nullable | epoch ms; advanced when a run is admitted |
| `last_run_at` | integer nullable | epoch ms |
| `time_created` / `time_updated` | integer | house `Timestamps` |

### `automation_run`

| column | type | notes |
| --- | --- | --- |
| `id` | text PK | `atr_...` |
| `automation_id` | text FK -> `automation.id` cascade | |
| `session_id` | text nullable | session used for the run |
| `status` | text | `queued` \| `running` \| `done` \| `failed` \| `skipped` |
| `outcome` | text nullable | `verified` `reported` `verification_failed` `budget_exceeded` `timed_out` `provider_error` `project_unavailable` `session_unavailable` `previous_run_active` `budget_exhausted` `cancelled` |
| `summary` | text nullable | short human summary (final assistant text tail / failure reason) |
| `evidence` | text nullable | verification results (command, exit code, output tail) |
| `tokens_total` | integer | summed usage for the run |
| `cost` | real | usage cost when known |
| `unread` | integer (0/1) | inbox indicator |
| `scheduled_for` | integer nullable | which due time this run fulfilled |
| `trigger` | text | `schedule` \| `manual` |
| `time_created` / `time_started` / `time_finished` | integer | |

Indices: `automation(status, next_run_at)`, `automation(directory)`,
`automation_run(automation_id, time_created)`, `automation_run(session_id)`.

IDs are branded schemas in `packages/schema/src/automation.ts`; prefixes `atm`/`atr`
registered in `packages/core/src/id/id.ts`.

## Schedule

Wire union (`packages/schema/src/automation.ts`):

```ts
type Schedule =
  | { type: "interval"; minutes: number }           // >= 1
  | { type: "daily"; time: string }                 // "HH:MM" local
  | { type: "weekly"; weekday: number; time: string }   // 0 = Sunday
  | { type: "monthly"; day: number; time: string }      // 1..28
  | { type: "cron"; expression: string }            // "min hour dom mon dow"
```

Parser/formatter/next-run in `packages/core/src/automation/schedule.ts`:

- `parse(text)` accepts: `every N minute(s)/hour(s)`, `hourly`, `every hour`, `daily`,
  `daily at HH:MM`, `every day at HH:MM`, `weekly`, `weekly on <weekday> at HH:MM`,
  `every <weekday> at HH:MM`, `monthly`, `monthly on the Nth at HH:MM`, `cron <expr>`,
  and a bare five-field cron expression.
- `format(schedule)` renders human text for UI/tool output.
- `next(schedule, after: Date): Date | null`, local timezone; cron supports `*`, `*/n`,
  lists (`a,b`), ranges (`a-b`) per field; weekday `0-6` and names.

## Execution lifecycle

Server-side scheduler (`packages/opencode/src/automation/scheduler.ts`, started in the
server app graph, 30s tick):

1. Query due automations (`status = active`, `next_run_at <= now`) via the core
   `Automation` service.
2. For each: create a run row, advance `next_run_at` (schedule.next from the missed due
   time, or now if far in the past), fork the engine, never overlap runs of the same
   automation (skip with `previous_run_active`).
3. Engine (`packages/opencode/src/automation/engine.ts`) wraps work in
   `InstanceStore.provide({ directory }, ...)`:
   - day-budget precheck: sum today's `automation_run.tokens_total`; over cap -> `skipped` /
     `budget_exhausted`.
   - session: `standalone` -> `Session.create({ title, agent, model, permission })`;
     `thread` -> load target session, fail `session_unavailable` when missing.
   - mark the session unattended; register the budget tracker and claim owner.
   - `SessionPrompt.prompt({ sessionID, agent?, model?, system: preamble, parts: [text] })`
     with a wall-clock timeout (`timeout_minutes`, outcome `timed_out`).
   - verification gate: run the automation's checks in the project directory; all pass ->
     `verified`, any fail -> `verification_failed`, no checks -> `reported`.
   - record tokens/cost from the session row, release claims, clear unattended flag.
   - `budget_exceeded` pauses the automation; other failures leave it active.
   - publish `automation.run.updated`; terminal runs are unread unless `skipped`.

System preamble injected per run: unattended (nobody can answer questions; decide and
proceed), profile description, verification commands are the definition of done, report
format (concise; state what changed and what was verified).

Manual runs (`POST /automation/:id/run`) use the same engine with `trigger: "manual"`.

## Permission profiles

Compiled to `PermissionV1.Ruleset` and stored on the session at creation
(`Session.create({ permission })`; tools merge agent + session rules, last match wins).

Common rules for every profile:

- `question: deny` (unattended runs must not ask the user)
- `doom_loop: allow` (the processor merges the session ruleset for this check)
- `read`/`glob`/`grep`/`list`/`webfetch`/`websearch`/`lsp`/`todowrite`: allow
- `.env` reads: allow (session rules win over the default ask)

Profile-specific:

- `read-only`: `edit: deny`, `task: deny`, `external_directory: deny`. `bash` stays allowed
  (not sandboxed; documented limitation — the profile blocks write tools, not shell).
- `workspace-write` (default): `edit: allow`, `task: allow`, `external_directory: deny`.
- `full`: everything allow, including `external_directory`.

Safety net: `packages/opencode/src/automation/unattended.ts` tracks unattended session IDs;
`Permission.ask` converts any surviving `ask` outcome into a deny for those sessions, so an
unattended run can never hang on a prompt.

## Budgets

`packages/opencode/src/automation/budget.ts` is a process-global tracker (module-level,
like the edit locks):

- engine registers `{ sessionID, runID, automationID, perRunTokens, perDayRemaining }`.
- `SessionProcessor` step-finish calls `consume(sessionID, tokens, cost)` after usage is
  computed. Over budget -> die with `BudgetExceededError`, aborting the step. The processor's
  error halt converts the defect into a failed assistant message, so the engine reads the
  verdict from the tracker instead: `consume` records `exceeded: { scope, limit, used }` and
  `finish()` returns it with the run totals.
- engine sees `exceeded`, sets outcome `budget_exceeded`, and pauses the automation.
- daily caps are enforced at admission by summing today's runs.

Token total = input + output + reasoning + cache read + cache write.

## File claims

`packages/opencode/src/claim/registry.ts`, process-global service:

- owner = the session that acquired the claim. Two distinct sessions conflict; a session
  re-acquiring its own path is allowed. Claims are released when the owning session's
  prompt loop ends (which covers subagent sessions) and when an automation run finishes.
- acquire before writing in `write`, `edit`, `apply_patch` (all touched paths). Conflict ->
  tool error naming the holder; same-owner re-entry is allowed.
- claims TTL 30 minutes from last use (reap loop every minute); automation runs release
  their claims at run end.
- `shell` writes are not claimed (documented limitation).

## Agent tool

`packages/opencode/src/tool/automation.ts`, registered in the tool registry:

`automation(action: create|list|get|update|pause|resume|run|delete, ...)` with `name`,
`prompt`, `schedule`, `kind`, `target_session_id`, `agent`, `model`, `profile`,
`budget_tokens_per_run`, `budget_tokens_per_day`, `verification`, `id`. Lets the user
create automations conversationally ("every morning at 8, brief me on yesterday's
commits"). Directory comes from the instance context; `kind: thread` defaults the target
to the current session. `action: run` goes through the process-global `AutomationTrigger`
bridge (the tool cannot import the engine without a module cycle) and reports that the
engine is unavailable when no layer has registered.

## HTTP API (instance group `automation`)

- `GET /automation` -> `{ automations, runs }` for the request directory (latest 100 runs)
- `POST /automation` create, `PATCH /automation/:id`, `DELETE /automation/:id`
- `POST /automation/:id/run` -> run now (returns the run)
- `GET /automation/:id/runs?limit=`
- `POST /automation/runs/read` -> mark all runs for the directory read

Events are defined with the automation schemas in `packages/schema/src/automation.ts`
and surfaced through `ServerDefinitions` in `event-manifest.ts`:
`automation.updated` `{ automation }`, `automation.run.updated` `{ run }`.

## App UI

- Route `/automations` in both layouts, entry in the Home utility nav (`sidebar` area).
- Page: automations grouped by project directory (name, schedule, status, profile,
  verification badge, next/last run, Run now, Pause/Resume, Delete, expandable runs with
  unread dots, outcome, time, tokens, Open session) + New automation dialog (project,
  prompt, schedule, profile, verification, budgets, timeout) + Mark all read + empty state.
  Live updates from `automation.updated` / `automation.run.updated` events; requests go
  through `ServerSDK.request` with the `directory` query parameter.
- i18n keys under `automations.*` in `packages/app/src/i18n/en.ts` (English-first; parity
  drift accepted).

## Acceptance gates

1. `packages/core`: migration generated and in sync (`bun script/migration.ts --check`);
   schedule parser/formatter/next-run tests; automation service tests.
2. `packages/opencode`: claim registry tests; unattended guard test; budget tracker test;
   verification runner tests; scheduler due-selection test; engine bookkeeping test
   (mocked prompt); HTTP endpoint tests; tool tests.
3. `packages/app`: controller/helper tests; `bun typecheck` clean in core, opencode, app.
4. Installed app: automations page renders, create via tool works, a manual run produces a
   session and a run row, verification outcome recorded.
