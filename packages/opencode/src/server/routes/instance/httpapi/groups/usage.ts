import { Usage } from "@opencode-ai/schema/usage"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/usage/summary"

export const UsageApi = HttpApi.make("usage")
  .add(
    HttpApiGroup.make("usage")
      .add(
        HttpApiEndpoint.get("summary", root, {
          query: Schema.Struct({
            ...WorkspaceRoutingQueryFields,
            from: Schema.optional(Schema.NumberFromString.annotate({ description: "Epoch milliseconds" })),
            to: Schema.optional(Schema.NumberFromString.annotate({ description: "Epoch milliseconds" })),
          }),
          success: described(Schema.Array(Usage.SummaryRow), "Usage grouped by local day, provider, and model"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "usage.summary",
            summary: "Summarize token and cost usage",
            description:
              "Aggregate recorded assistant usage by local calendar day, provider, and model. Unset range covers all recorded usage.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "usage", description: "Token and cost usage routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode HttpApi",
      version: "0.0.1",
      description: "Effect HttpApi surface for instance routes.",
    }),
  )
