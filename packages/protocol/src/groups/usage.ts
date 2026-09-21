import { Usage } from "@opencode-ai/schema/usage"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const UsageGroup = HttpApiGroup.make("server.usage")
  .add(
    HttpApiEndpoint.get("usage.summary", "/api/usage/summary", {
      query: Usage.Query,
      success: Schema.Array(Usage.SummaryRow),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.usage.summary",
        summary: "Summarize token and cost usage",
        description:
          "Aggregate recorded assistant usage by local calendar day, provider, and model. Unset range covers all recorded usage.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "usage", description: "Token and cost usage routes." }))
