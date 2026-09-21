import { Automation } from "@opencode-ai/core/automation"
import { Schedule as AutomationSchedule } from "@opencode-ai/core/automation/schedule"
import { Model } from "@opencode-ai/schema/model"
import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Schema, Cause } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AutomationTrigger } from "@/automation/trigger"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "list", "get", "update", "pause", "resume", "run", "delete"]),
  id: Schema.optional(Schema.String).annotate({ description: "Automation ID (atm_...) for get/update/pause/resume/run/delete" }),
  name: Schema.optional(Schema.String).annotate({ description: "Short display name" }),
  prompt: Schema.optional(Schema.String).annotate({ description: "The prompt each run should execute" }),
  schedule: Schema.optional(Schema.String).annotate({
    description:
      'When to run, e.g. "every 30 minutes", "daily at 08:00", "weekly on monday at 09:00", "cron 0 9 * * 1-5"',
  }),
  kind: Schema.optional(Schema.Literals(["standalone", "thread"])).annotate({
    description: "standalone starts a fresh session per run; thread continues an existing session",
  }),
  target_session_id: Schema.optional(Schema.String).annotate({
    description: "Target session for thread automations (defaults to the current session)",
  }),
  agent: Schema.optional(Schema.String).annotate({ description: "Agent to run with (defaults to the configured default agent)" }),
  model: Schema.optional(Schema.String).annotate({ description: 'Model as "provider/model"' }),
  profile: Schema.optional(Schema.Literals(["read-only", "workspace-write", "full"])).annotate({
    description: "Permission profile for unattended runs (defaults to workspace-write)",
  }),
  budget_tokens_per_run: Schema.optional(Schema.Number).annotate({ description: "Hard token cap for a single run" }),
  budget_tokens_per_day: Schema.optional(Schema.Number).annotate({ description: "Hard token cap for all runs of this automation per day" }),
  verification: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Commands that define done; they run after each run and must exit 0",
  }),
  timeout_minutes: Schema.optional(Schema.Number).annotate({ description: "Wall-clock limit per run (default 30)" }),
})

type Params = Schema.Schema.Type<typeof Parameters>

const DESCRIPTION = `Create and manage scheduled automations that run unattended in the background.

Automations run while the app is open. Each run works in the project directory, uses a permission profile (no prompts), and can enforce verification commands as its definition of done. Use action "create" with a prompt and a schedule to schedule recurring work; use "list" to see existing automations and "run" to trigger one now.`

function parseSchedule(input: string | undefined) {
  if (!input) return undefined
  return AutomationSchedule.parse(input)
}

function modelRef(input: string | undefined): Model.Ref | undefined {
  if (!input) return undefined
  const [providerID, ...rest] = input.split("/")
  const id = rest.join("/")
  if (!providerID || !id) return undefined
  return { providerID: ProviderV2.ID.make(providerID), id: ModelV2.ID.make(id) }
}

function require<T>(value: T | undefined, message: string) {
  if (value === undefined) throw new Error(message)
  return value
}

function find(automations: Automation.Info[], id: string | undefined) {
  const found = automations.find((item) => item.id === id)
  if (!found) throw new Error(`Automation not found: ${id ?? "(missing id)"}`)
  return found
}

export const AutomationTool = Tool.define<
  typeof Parameters,
  Record<string, never>,
  Automation.Service | EventV2Bridge.Service
>(
  "automation",
  Effect.gen(function* () {
    const automations = yield* Automation.Service
    const events = yield* EventV2Bridge.Service

    const publish = (info: Automation.Info | undefined) =>
      events.publish(AutomationSchema.Event.Updated, { automation: info ?? null }).pipe(Effect.ignore)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context<Record<string, never>>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const scoped = yield* automations.list(instance.directory)

          if (params.action === "list") {
            return {
              title: `${scoped.length} automation${scoped.length === 1 ? "" : "s"}`,
              output: JSON.stringify(
                scoped.map((item) => ({
                  id: item.id,
                  name: item.name,
                  schedule: AutomationSchedule.format(item.schedule),
                  nextRunAt: item.nextRunAt,
                  status: item.status,
                  profile: item.profile,
                  kind: item.kind,
                })),
                null,
                2,
              ),
              metadata: {},
            }
          }

          if (params.action === "create") {
            yield* ctx.ask({ permission: "automation", patterns: ["create"], always: ["*"], metadata: {} })
            const schedule = require(parseSchedule(params.schedule), "A valid schedule is required to create an automation")
            const prompt = require(params.prompt, "A prompt is required to create an automation")
            const kind = params.kind ?? "standalone"
            const target = kind === "thread" ? (params.target_session_id ?? ctx.sessionID) : undefined
            const model = modelRef(params.model)
            const created = yield* automations.create({
              projectID: instance.project.id,
              directory: instance.directory,
              name: params.name ?? prompt.slice(0, 48),
              prompt,
              kind,
              ...(target ? { targetSessionID: target } : {}),
              ...(params.agent ? { agent: params.agent } : {}),
              ...(model ? { model } : {}),
              profile: params.profile ?? "workspace-write",
              schedule,
              verification: (params.verification ?? []).map((command) => ({ command })),
              ...(params.budget_tokens_per_run ? { budgetPerRunTokens: Math.round(params.budget_tokens_per_run) } : {}),
              ...(params.budget_tokens_per_day ? { budgetPerDayTokens: Math.round(params.budget_tokens_per_day) } : {}),
              timeoutMinutes: params.timeout_minutes ? Math.round(params.timeout_minutes) : 30,
              status: "active",
              nextRunAt: AutomationSchedule.next(schedule, new Date())?.getTime(),
            })
            yield* publish(created)
            return {
              title: `Automation created: ${created.name}`,
              output: JSON.stringify(
                {
                  id: created.id,
                  name: created.name,
                  schedule: AutomationSchedule.format(created.schedule),
                  nextRunAt: created.nextRunAt,
                  profile: created.profile,
                },
                null,
                2,
              ),
              metadata: {},
            }
          }

          if (params.action === "get") {
            const found = find(scoped, params.id)
            const runs = yield* automations.listRuns([found.id], 5)
            return {
              title: found.name,
              output: JSON.stringify({ ...found, scheduleText: AutomationSchedule.format(found.schedule), runs }, null, 2),
              metadata: {},
            }
          }

          if (params.action === "run") {
            yield* ctx.ask({ permission: "automation", patterns: ["run"], always: ["*"], metadata: {} })
            const found = find(scoped, params.id)
            if (!AutomationTrigger.available()) {
              return {
                title: "Automation engine unavailable",
                output: "The automation engine is not running in this process, so the run was not started.",
                metadata: {},
              }
            }
            const run = yield* AutomationTrigger.run({ automation: found, trigger: "manual" })
            return {
              title: `Started: ${found.name}`,
              output: JSON.stringify({ runID: run.id, status: run.status, sessionID: run.sessionID }, null, 2),
              metadata: {},
            }
          }

          if (params.action === "delete") {
            yield* ctx.ask({ permission: "automation", patterns: ["delete"], always: ["*"], metadata: {} })
            const found = find(scoped, params.id)
            yield* automations.remove(found.id)
            yield* publish(undefined)
            return { title: `Deleted: ${found.name}`, output: JSON.stringify({ id: found.id }), metadata: {} }
          }

          yield* ctx.ask({ permission: "automation", patterns: [params.action], always: ["*"], metadata: {} })
          const found = find(scoped, params.id)
          const schedule = parseSchedule(params.schedule)
          const model = modelRef(params.model)
          const pause = params.action === "pause"
          const resume = params.action === "resume"
          const next = resume ? AutomationSchedule.next(schedule ?? found.schedule, new Date())?.getTime() : undefined
          const updated = yield* automations.update(found.id, {
            ...(params.name !== undefined ? { name: params.name } : {}),
            ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
            ...(schedule !== undefined ? { schedule } : {}),
            ...(params.profile !== undefined ? { profile: params.profile } : {}),
            ...(params.agent !== undefined ? { agent: params.agent } : {}),
            ...(model ? { model } : {}),
            ...(params.verification !== undefined
              ? { verification: params.verification.map((command) => ({ command })) }
              : {}),
            ...(params.budget_tokens_per_run !== undefined
              ? { budgetPerRunTokens: Math.round(params.budget_tokens_per_run) }
              : {}),
            ...(params.budget_tokens_per_day !== undefined
              ? { budgetPerDayTokens: Math.round(params.budget_tokens_per_day) }
              : {}),
            ...(params.timeout_minutes !== undefined ? { timeoutMinutes: Math.round(params.timeout_minutes) } : {}),
            ...(pause ? { status: "paused" as const } : {}),
            ...(resume ? { status: "active" as const, nextRunAt: next } : {}),
            ...(schedule !== undefined && !pause && !resume
              ? { nextRunAt: AutomationSchedule.next(schedule, new Date())?.getTime() }
              : {}),
          })
          yield* publish(updated)
          return {
            title: `${updated?.name ?? found.name} ${pause ? "paused" : resume ? "resumed" : "updated"}`,
            output: JSON.stringify(updated ?? found, null, 2),
            metadata: {},
          }
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.succeed({
              title: "Automation error",
              output: error instanceof Error ? error.message : String(error),
              metadata: {},
            })
          }),
        ),
    } satisfies Tool.DefWithoutID<typeof Parameters, Record<string, never>>
  }),
)
