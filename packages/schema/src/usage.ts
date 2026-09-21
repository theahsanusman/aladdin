export * as Usage from "./usage"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema"

export const Tokens = Schema.Struct({
  input: Schema.Finite.annotate({ description: "Uncached input tokens" }),
  output: Schema.Finite.annotate({ description: "Output tokens" }),
  reasoning: Schema.Finite.annotate({ description: "Reasoning tokens" }),
  cache: Schema.Struct({
    read: Schema.Finite.annotate({ description: "Tokens read from the provider cache" }),
    write: Schema.Finite.annotate({ description: "Tokens written to the provider cache" }),
  }),
}).annotate({ identifier: "Usage.Tokens" })
export type Tokens = Schema.Schema.Type<typeof Tokens>

export const SummaryRow = Schema.Struct({
  date: Schema.String.annotate({ description: "Local calendar date (YYYY-MM-DD) the usage was recorded" }),
  providerID: Schema.String,
  modelID: Schema.String,
  messages: NonNegativeInt.annotate({ description: "Number of assistant responses recorded" }),
  cost: Schema.Finite.annotate({ description: "Provider-reported cost in USD" }),
  tokens: Tokens,
}).annotate({ identifier: "Usage.SummaryRow" })
export type SummaryRow = Schema.Schema.Type<typeof SummaryRow>

export const Query = Schema.Struct({
  from: Schema.optional(NonNegativeInt).annotate({
    description: "Start of the range in epoch milliseconds. Unset means the beginning of recorded usage.",
  }),
  to: Schema.optional(NonNegativeInt).annotate({
    description: "End of the range in epoch milliseconds. Unset means now.",
  }),
}).annotate({ identifier: "Usage.Query" })
export type Query = Schema.Schema.Type<typeof Query>
