export * as Automation from "./automation"

import { Automation as AutomationSchema } from "@opencode-ai/schema/automation"
import { Model } from "@opencode-ai/schema/model"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { AbsolutePath } from "./schema"
import { AutomationRunTable, AutomationTable } from "./automation/sql"

export type Info = AutomationSchema.Info
export type Run = AutomationSchema.Run
export type { ID, Kind, Outcome, Profile, RunID, RunStatus, Schedule, Status } from "@opencode-ai/schema/automation"

export interface CreateInput {
  projectID: ProjectID
  directory: string
  name: string
  prompt: string
  kind: AutomationSchema.Kind
  targetSessionID?: string
  agent?: string
  model?: Model.Ref
  profile: AutomationSchema.Profile
  schedule: AutomationSchema.Schedule
  verification: AutomationSchema.Check[]
  budgetPerRunTokens?: number
  budgetPerDayTokens?: number
  timeoutMinutes: number
  status: AutomationSchema.Status
  nextRunAt?: number
}

export interface UpdateInput {
  name?: string
  prompt?: string
  kind?: AutomationSchema.Kind
  targetSessionID?: string | null
  agent?: string | null
  model?: Model.Ref | null
  profile?: AutomationSchema.Profile
  schedule?: AutomationSchema.Schedule
  verification?: AutomationSchema.Check[]
  budgetPerRunTokens?: number | null
  budgetPerDayTokens?: number | null
  timeoutMinutes?: number
  status?: AutomationSchema.Status
  nextRunAt?: number | null
  lastRunAt?: number | null
}

export interface CreateRunInput {
  automationID: AutomationSchema.ID
  status: AutomationSchema.RunStatus
  trigger: "schedule" | "manual"
  sessionID?: string
  scheduledFor?: number
}

export interface UpdateRunInput {
  status?: AutomationSchema.RunStatus
  outcome?: AutomationSchema.Outcome
  summary?: string
  evidence?: string
  tokensTotal?: number
  cost?: number
  unread?: boolean
  sessionID?: string
  timeStarted?: number
  timeFinished?: number
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly get: (id: AutomationSchema.ID) => Effect.Effect<Info | undefined>
  readonly list: (directory?: string) => Effect.Effect<Info[]>
  readonly due: (now: number, limit?: number) => Effect.Effect<Info[]>
  readonly update: (id: AutomationSchema.ID, patch: UpdateInput) => Effect.Effect<Info | undefined>
  readonly remove: (id: AutomationSchema.ID) => Effect.Effect<void>
  readonly createRun: (input: CreateRunInput) => Effect.Effect<Run>
  readonly updateRun: (id: AutomationSchema.RunID, patch: UpdateRunInput) => Effect.Effect<Run | undefined>
  readonly listRuns: (automationIDs: ReadonlyArray<AutomationSchema.ID>, limit: number) => Effect.Effect<Run[]>
  readonly markRunsRead: (automationIDs: ReadonlyArray<AutomationSchema.ID>) => Effect.Effect<void>
  readonly tokensSince: (automationID: AutomationSchema.ID, since: number) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Automation") {}

type AutomationRow = typeof AutomationTable.$inferSelect
type RunRow = typeof AutomationRunTable.$inferSelect

export function automationFromRow(row: AutomationRow): Info {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: AbsolutePath.make(row.directory),
    name: row.name,
    prompt: row.prompt,
    kind: row.kind,
    ...(row.target_session_id ? { targetSessionID: row.target_session_id } : {}),
    ...(row.agent ? { agent: row.agent } : {}),
    ...(row.model ? { model: row.model } : {}),
    profile: row.profile,
    schedule: row.schedule,
    verification: row.verification,
    ...(row.budget_per_run_tokens !== null ? { budgetPerRunTokens: row.budget_per_run_tokens } : {}),
    ...(row.budget_per_day_tokens !== null ? { budgetPerDayTokens: row.budget_per_day_tokens } : {}),
    timeoutMinutes: row.timeout_minutes,
    status: row.status,
    ...(row.next_run_at !== null ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_run_at !== null ? { lastRunAt: row.last_run_at } : {}),
    time: { created: row.time_created, updated: row.time_updated },
  }
}

export function runFromRow(row: RunRow): Run {
  return {
    id: row.id,
    automationID: row.automation_id,
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    status: row.status,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.evidence ? { evidence: row.evidence } : {}),
    tokensTotal: row.tokens_total,
    cost: row.cost,
    unread: row.unread === 1,
    trigger: row.trigger,
    ...(row.scheduled_for !== null ? { scheduledFor: row.scheduled_for } : {}),
    time: {
      created: row.time_created,
      ...(row.time_started !== null ? { started: row.time_started } : {}),
      ...(row.time_finished !== null ? { finished: row.time_finished } : {}),
    },
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const create = Effect.fn("Automation.create")(function* (input: CreateInput) {
      const now = Date.now()
      const id = AutomationSchema.ID.create()
      yield* db
        .insert(AutomationTable)
        .values({
          id,
          project_id: input.projectID,
          directory: input.directory,
          name: input.name,
          prompt: input.prompt,
          kind: input.kind,
          target_session_id: input.targetSessionID ?? null,
          agent: input.agent ?? null,
          model: input.model ?? null,
          profile: input.profile,
          schedule: input.schedule,
          verification: input.verification,
          budget_per_run_tokens: input.budgetPerRunTokens ?? null,
          budget_per_day_tokens: input.budgetPerDayTokens ?? null,
          timeout_minutes: input.timeoutMinutes,
          status: input.status,
          next_run_at: input.nextRunAt ?? null,
          last_run_at: null,
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      return automationFromRow({
        id,
        project_id: input.projectID,
        directory: input.directory,
        name: input.name,
        prompt: input.prompt,
        kind: input.kind,
        target_session_id: input.targetSessionID ?? null,
        agent: input.agent ?? null,
        model: input.model ?? null,
        profile: input.profile,
        schedule: input.schedule,
        verification: input.verification,
        budget_per_run_tokens: input.budgetPerRunTokens ?? null,
        budget_per_day_tokens: input.budgetPerDayTokens ?? null,
        timeout_minutes: input.timeoutMinutes,
        status: input.status,
        next_run_at: input.nextRunAt ?? null,
        last_run_at: null,
        time_created: now,
        time_updated: now,
      })
    })

    const get = Effect.fn("Automation.get")(function* (id: AutomationSchema.ID) {
      const row = yield* db.select().from(AutomationTable).where(eq(AutomationTable.id, id)).get().pipe(Effect.orDie)
      return row ? automationFromRow(row) : undefined
    })

    const list = Effect.fn("Automation.list")(function* (directory?: string) {
      const rows = yield* db
        .select()
        .from(AutomationTable)
        .where(directory === undefined ? undefined : eq(AutomationTable.directory, directory))
        .orderBy(asc(AutomationTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(automationFromRow)
    })

    const due = Effect.fn("Automation.due")(function* (now: number, limit = 25) {
      const rows = yield* db
        .select()
        .from(AutomationTable)
        .where(
          and(
            eq(AutomationTable.status, "active"),
            isNotNull(AutomationTable.next_run_at),
            lte(AutomationTable.next_run_at, now),
          ),
        )
        .orderBy(asc(AutomationTable.next_run_at))
        .limit(limit)
        .all()
        .pipe(Effect.orDie)
      return rows.map(automationFromRow)
    })

    const update = Effect.fn("Automation.update")(function* (id: AutomationSchema.ID, patch: UpdateInput) {
      const values: Partial<typeof AutomationTable.$inferInsert> = {}
      if (patch.name !== undefined) values.name = patch.name
      if (patch.prompt !== undefined) values.prompt = patch.prompt
      if (patch.kind !== undefined) values.kind = patch.kind
      if (patch.targetSessionID !== undefined) values.target_session_id = patch.targetSessionID
      if (patch.agent !== undefined) values.agent = patch.agent
      if (patch.model !== undefined) values.model = patch.model
      if (patch.profile !== undefined) values.profile = patch.profile
      if (patch.schedule !== undefined) values.schedule = patch.schedule
      if (patch.verification !== undefined) values.verification = patch.verification
      if (patch.budgetPerRunTokens !== undefined) values.budget_per_run_tokens = patch.budgetPerRunTokens
      if (patch.budgetPerDayTokens !== undefined) values.budget_per_day_tokens = patch.budgetPerDayTokens
      if (patch.timeoutMinutes !== undefined) values.timeout_minutes = patch.timeoutMinutes
      if (patch.status !== undefined) values.status = patch.status
      if (patch.nextRunAt !== undefined) values.next_run_at = patch.nextRunAt
      if (patch.lastRunAt !== undefined) values.last_run_at = patch.lastRunAt
      if (Object.keys(values).length === 0) return yield* get(id)
      yield* db.update(AutomationTable).set(values).where(eq(AutomationTable.id, id)).run().pipe(Effect.orDie)
      return yield* get(id)
    })

    const remove = Effect.fn("Automation.remove")(function* (id: AutomationSchema.ID) {
      yield* db.delete(AutomationTable).where(eq(AutomationTable.id, id)).run().pipe(Effect.orDie)
    })

    const getRun = Effect.fn("Automation.getRun")(function* (id: AutomationSchema.RunID) {
      const row = yield* db.select().from(AutomationRunTable).where(eq(AutomationRunTable.id, id)).get().pipe(Effect.orDie)
      return row ? runFromRow(row) : undefined
    })

    const createRun = Effect.fn("Automation.createRun")(function* (input: CreateRunInput) {
      const id = AutomationSchema.RunID.create()
      const now = Date.now()
      yield* db
        .insert(AutomationRunTable)
        .values({
          id,
          automation_id: input.automationID,
          session_id: input.sessionID ?? null,
          status: input.status,
          outcome: null,
          summary: null,
          evidence: null,
          tokens_total: 0,
          cost: 0,
          unread: 0,
          trigger: input.trigger,
          scheduled_for: input.scheduledFor ?? null,
          time_created: now,
          time_started: input.status === "running" ? now : null,
          time_finished: null,
        })
        .run()
        .pipe(Effect.orDie)
      return (yield* getRun(id))!
    })

    const updateRun = Effect.fn("Automation.updateRun")(function* (id: AutomationSchema.RunID, patch: UpdateRunInput) {
      const values: Partial<typeof AutomationRunTable.$inferInsert> = {}
      if (patch.status !== undefined) values.status = patch.status
      if (patch.outcome !== undefined) values.outcome = patch.outcome
      if (patch.summary !== undefined) values.summary = patch.summary
      if (patch.evidence !== undefined) values.evidence = patch.evidence
      if (patch.tokensTotal !== undefined) values.tokens_total = patch.tokensTotal
      if (patch.cost !== undefined) values.cost = patch.cost
      if (patch.unread !== undefined) values.unread = patch.unread ? 1 : 0
      if (patch.sessionID !== undefined) values.session_id = patch.sessionID
      if (patch.timeStarted !== undefined) values.time_started = patch.timeStarted
      if (patch.timeFinished !== undefined) values.time_finished = patch.timeFinished
      if (Object.keys(values).length > 0) {
        yield* db.update(AutomationRunTable).set(values).where(eq(AutomationRunTable.id, id)).run().pipe(Effect.orDie)
      }
      return yield* getRun(id)
    })

    const listRuns = Effect.fn("Automation.listRuns")(function* (
      automationIDs: ReadonlyArray<AutomationSchema.ID>,
      limit: number,
    ) {
      if (automationIDs.length === 0) return []
      const rows = yield* db
        .select()
        .from(AutomationRunTable)
        .where(inArray(AutomationRunTable.automation_id, [...automationIDs]))
        .orderBy(desc(AutomationRunTable.time_created))
        .limit(limit)
        .all()
        .pipe(Effect.orDie)
      return rows.map(runFromRow)
    })

    const markRunsRead = Effect.fn("Automation.markRunsRead")(function* (
      automationIDs: ReadonlyArray<AutomationSchema.ID>,
    ) {
      if (automationIDs.length === 0) return
      yield* db
        .update(AutomationRunTable)
        .set({ unread: 0 })
        .where(and(inArray(AutomationRunTable.automation_id, [...automationIDs]), eq(AutomationRunTable.unread, 1)))
        .run()
        .pipe(Effect.orDie)
    })

    const tokensSince = Effect.fn("Automation.tokensSince")(function* (
      automationID: AutomationSchema.ID,
      since: number,
    ) {
      const rows = yield* db
        .select({ tokens: AutomationRunTable.tokens_total })
        .from(AutomationRunTable)
        .where(and(eq(AutomationRunTable.automation_id, automationID), gte(AutomationRunTable.time_created, since)))
        .all()
        .pipe(Effect.orDie)
      return rows.reduce((total, row) => total + row.tokens, 0)
    })

    return Service.of({
      create,
      get,
      list,
      due,
      update,
      remove,
      createRun,
      updateRun,
      listRuns,
      markRunsRead,
      tokensSince,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
