import { Automation } from "@opencode-ai/core/automation"
import { Schedule as AutomationSchedule } from "@opencode-ai/core/automation/schedule"
import { Model } from "@opencode-ai/schema/model"
import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { AutomationCreatePayload, AutomationUpdatePayload } from "../groups/automation"
import { InvalidRequestError, notFound } from "../errors"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AutomationEngine } from "@/automation/engine"

function modelRef(input: string | undefined): Model.Ref | undefined {
  if (!input) return undefined
  const [providerID, ...rest] = input.split("/")
  const id = rest.join("/")
  if (!providerID || !id) return undefined
  return { providerID: ProviderV2.ID.make(providerID), id: ModelV2.ID.make(id) }
}

function positive(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

function budget(value: number | undefined) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 1) return undefined
  return Math.round(value)
}

export const automationHandlers = HttpApiBuilder.group(InstanceHttpApi, "automation", (handlers) =>
  Effect.gen(function* () {
    const automations = yield* Automation.Service
    const engine = yield* AutomationEngine.Service
    const events = yield* EventV2Bridge.Service

    const publish = (info: Automation.Info | undefined) =>
      events.publish(AutomationSchema.Event.Updated, { automation: info ?? null }).pipe(Effect.ignore)

    const parseSchedule = (text: string) =>
      Effect.gen(function* () {
        const schedule = AutomationSchedule.parse(text)
        if (!schedule) return yield* Effect.fail(new InvalidRequestError({ message: `Invalid schedule: ${text}` }))
        return schedule
      })

    const find = Effect.fnUntraced(function* (id: AutomationSchema.ID, directory: string) {
      const found = yield* automations.get(id)
      if (!found || found.directory !== directory) return yield* Effect.fail(notFound(`Automation not found: ${id}`))
      return found
    })

    const list = Effect.fn("AutomationHttpApi.list")(function* () {
      const instance = yield* InstanceState.context
      const scoped = yield* automations.list(instance.directory)
      const runs = yield* automations.listRuns(
        scoped.map((item) => item.id),
        100,
      )
      return { automations: scoped, runs }
    })

    const create = Effect.fn("AutomationHttpApi.create")(function* (ctx: {
      payload: typeof AutomationCreatePayload.Type
    }) {
      const instance = yield* InstanceState.context
      const schedule = yield* parseSchedule(ctx.payload.schedule)
      const model = modelRef(ctx.payload.model)
      const kind = ctx.payload.kind ?? "standalone"
      if (kind === "thread" && !ctx.payload.targetSessionID) {
        return yield* Effect.fail(new InvalidRequestError({ message: "targetSessionID is required for thread automations" }))
      }
      const created = yield* automations.create({
        projectID: instance.project.id,
        directory: instance.directory,
        name: ctx.payload.name?.trim() || ctx.payload.prompt.slice(0, 48),
        prompt: ctx.payload.prompt,
        kind,
        ...(ctx.payload.targetSessionID ? { targetSessionID: ctx.payload.targetSessionID } : {}),
        ...(ctx.payload.agent ? { agent: ctx.payload.agent } : {}),
        ...(model ? { model } : {}),
        profile: ctx.payload.profile ?? "workspace-write",
        schedule,
        verification: (ctx.payload.verification ?? []).map((command) => ({ command })),
        ...(budget(ctx.payload.budgetPerRunTokens) !== undefined
          ? { budgetPerRunTokens: budget(ctx.payload.budgetPerRunTokens) }
          : {}),
        ...(budget(ctx.payload.budgetPerDayTokens) !== undefined
          ? { budgetPerDayTokens: budget(ctx.payload.budgetPerDayTokens) }
          : {}),
        timeoutMinutes: positive(ctx.payload.timeoutMinutes, 30),
        status: "active",
        nextRunAt: AutomationSchedule.next(schedule, new Date())?.getTime(),
      })
      yield* publish(created)
      return created
    })

    const update = Effect.fn("AutomationHttpApi.update")(function* (ctx: {
      params: { id: AutomationSchema.ID }
      payload: typeof AutomationUpdatePayload.Type
    }) {
      const instance = yield* InstanceState.context
      const found = yield* find(ctx.params.id, instance.directory)
      const schedule = ctx.payload.schedule === undefined ? undefined : yield* parseSchedule(ctx.payload.schedule)
      const model = modelRef(ctx.payload.model)
      const kind = ctx.payload.kind
      if (kind === "thread" && !(ctx.payload.targetSessionID ?? found.targetSessionID)) {
        return yield* Effect.fail(new InvalidRequestError({ message: "targetSessionID is required for thread automations" }))
      }
      const status = ctx.payload.status
      const nextSchedule = schedule ?? found.schedule
      const updated = yield* automations.update(found.id, {
        ...(ctx.payload.name !== undefined ? { name: ctx.payload.name } : {}),
        ...(ctx.payload.prompt !== undefined ? { prompt: ctx.payload.prompt } : {}),
        ...(schedule !== undefined ? { schedule } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(ctx.payload.targetSessionID !== undefined ? { targetSessionID: ctx.payload.targetSessionID } : {}),
        ...(ctx.payload.agent !== undefined ? { agent: ctx.payload.agent } : {}),
        ...(model ? { model } : {}),
        ...(ctx.payload.profile !== undefined ? { profile: ctx.payload.profile } : {}),
        ...(ctx.payload.verification !== undefined
          ? { verification: ctx.payload.verification.map((command) => ({ command })) }
          : {}),
        ...(budget(ctx.payload.budgetPerRunTokens) !== undefined
          ? { budgetPerRunTokens: budget(ctx.payload.budgetPerRunTokens) }
          : {}),
        ...(budget(ctx.payload.budgetPerDayTokens) !== undefined
          ? { budgetPerDayTokens: budget(ctx.payload.budgetPerDayTokens) }
          : {}),
        ...(ctx.payload.timeoutMinutes !== undefined
          ? { timeoutMinutes: positive(ctx.payload.timeoutMinutes, found.timeoutMinutes) }
          : {}),
        ...(status !== undefined ? { status } : {}),
        ...(status === "active" || (schedule !== undefined && found.status === "active")
          ? { nextRunAt: AutomationSchedule.next(nextSchedule, new Date())?.getTime() }
          : {}),
      })
      yield* publish(updated)
      return updated ?? found
    })

    const remove = Effect.fn("AutomationHttpApi.remove")(function* (ctx: { params: { id: AutomationSchema.ID } }) {
      const instance = yield* InstanceState.context
      const found = yield* find(ctx.params.id, instance.directory)
      yield* automations.remove(found.id)
      yield* publish(undefined)
      return true
    })

    const run = Effect.fn("AutomationHttpApi.run")(function* (ctx: { params: { id: AutomationSchema.ID } }) {
      const instance = yield* InstanceState.context
      const found = yield* find(ctx.params.id, instance.directory)
      return yield* engine.start({ automation: found, trigger: "manual" })
    })

    const runs = Effect.fn("AutomationHttpApi.runs")(function* (ctx: {
      params: { id: AutomationSchema.ID }
      query: { limit?: number }
    }) {
      const instance = yield* InstanceState.context
      const found = yield* find(ctx.params.id, instance.directory)
      return yield* automations.listRuns([found.id], positive(ctx.query.limit, 50))
    })

    const read = Effect.fn("AutomationHttpApi.read")(function* () {
      const instance = yield* InstanceState.context
      const scoped = yield* automations.list(instance.directory)
      yield* automations.markRunsRead(scoped.map((item) => item.id))
      return true
    })

    return handlers
      .handle("list", list)
      .handle("create", create)
      .handle("update", update)
      .handle("remove", remove)
      .handle("run", run)
      .handle("runs", runs)
      .handle("read", read)
  }),
)
