export * as Usage from "./usage"

import { and, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { MessageTable } from "./session/sql"
import type { SummaryRow } from "@opencode-ai/schema/usage"

export interface Interface {
  /** Usage grouped by local calendar day, provider, and model. */
  readonly summary: (input: { from?: number; to?: number }) => Effect.Effect<ReadonlyArray<SummaryRow>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Usage") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const created = sql<number>`CAST(json_extract(${MessageTable.data}, '$.time.created') AS INTEGER)`
    const date = sql<string>`strftime('%Y-%m-%d', ${created} / 1000, 'unixepoch', 'localtime')`
    const providerID = sql<string>`COALESCE(json_extract(${MessageTable.data}, '$.providerID'), 'unknown')`
    const modelID = sql<string>`COALESCE(json_extract(${MessageTable.data}, '$.modelID'), 'unknown')`

    const summary = Effect.fn("Usage.summary")(function* (input: { from?: number; to?: number }) {
      const rows = yield* db
        .select({
          date,
          providerID,
          modelID,
          messages: sql<number>`COUNT(*)`,
          cost: sql<number>`COALESCE(SUM(CAST(json_extract(${MessageTable.data}, '$.cost') AS REAL)), 0)`,
          input: sql<number>`COALESCE(SUM(CAST(json_extract(${MessageTable.data}, '$.tokens.input') AS REAL)), 0)`,
          output: sql<number>`COALESCE(SUM(CAST(json_extract(${MessageTable.data}, '$.tokens.output') AS REAL)), 0)`,
          reasoning: sql<number>`COALESCE(SUM(CAST(json_extract(${MessageTable.data}, '$.tokens.reasoning') AS REAL)), 0)`,
          cacheRead: sql<number>`COALESCE(SUM(CAST(json_extract(${MessageTable.data}, '$.tokens.cache.read') AS REAL)), 0)`,
          cacheWrite: sql<number>`COALESCE(SUM(CAST(json_extract(${MessageTable.data}, '$.tokens.cache.write') AS REAL)), 0)`,
        })
        .from(MessageTable)
        .where(
          and(
            sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
            sql`${created} >= ${input.from ?? 0}`,
            sql`${created} < ${input.to ?? Date.now()}`,
          ),
        )
        .groupBy(date, providerID, modelID)
        .orderBy(date)
        .all()
        .pipe(Effect.orDie)

      return rows.map(
        (row): SummaryRow => ({
          date: row.date,
          providerID: row.providerID,
          modelID: row.modelID,
          messages: row.messages,
          cost: row.cost,
          tokens: {
            input: row.input,
            output: row.output,
            reasoning: row.reasoning,
            cache: { read: row.cacheRead, write: row.cacheWrite },
          },
        }),
      )
    })

    return Service.of({ summary })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })
