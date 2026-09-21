import { Automation } from "@opencode-ai/schema/automation"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/automation"

export const AutomationCreatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  prompt: Schema.String,
  schedule: Schema.String.annotate({
    description: 'Human schedule text, for example "every 30 minutes", "daily at 08:00", or "cron 0 9 * * 1-5"',
  }),
  kind: Schema.optional(Automation.Kind),
  targetSessionID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String.annotate({ description: "Model as provider/model" })),
  profile: Schema.optional(Automation.Profile),
  budgetPerRunTokens: Schema.optional(Schema.Number),
  budgetPerDayTokens: Schema.optional(Schema.Number),
  verification: Schema.optional(Schema.Array(Schema.String)),
  timeoutMinutes: Schema.optional(Schema.Number),
})

export const AutomationUpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  schedule: Schema.optional(Schema.String),
  kind: Schema.optional(Automation.Kind),
  targetSessionID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  profile: Schema.optional(Automation.Profile),
  budgetPerRunTokens: Schema.optional(Schema.Number),
  budgetPerDayTokens: Schema.optional(Schema.Number),
  verification: Schema.optional(Schema.Array(Schema.String)),
  timeoutMinutes: Schema.optional(Schema.Number),
  status: Schema.optional(Automation.Status),
})

const IdParams = Schema.Struct({ id: Automation.ID })

const Overview = Schema.Struct({
  automations: Schema.Array(Automation.Info),
  runs: Schema.Array(Automation.Run),
}).annotate({ identifier: "Automation.Overview" })

export const AutomationApi = HttpApi.make("automation")
  .add(
    HttpApiGroup.make("automation")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Overview, "Automations and their latest runs for the request directory"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.list",
            summary: "List automations",
            description: "List automations with their latest runs for the current project directory.",
          }),
        ),
        HttpApiEndpoint.post("create", root, {
          query: WorkspaceRoutingQuery,
          payload: AutomationCreatePayload,
          success: described(Automation.Info, "Created automation"),
          error: [InvalidRequestError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.create",
            summary: "Create automation",
            description: "Create a scheduled automation for the current project directory.",
          }),
        ),
        HttpApiEndpoint.patch("update", `${root}/:id`, {
          params: IdParams,
          query: WorkspaceRoutingQuery,
          payload: AutomationUpdatePayload,
          success: described(Automation.Info, "Updated automation"),
          error: [InvalidRequestError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.update",
            summary: "Update automation",
            description: "Update an automation's prompt, schedule, profile, budgets, or status.",
          }),
        ),
        HttpApiEndpoint.delete("remove", `${root}/:id`, {
          params: IdParams,
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Automation removed"),
          error: [ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.remove",
            summary: "Delete automation",
            description: "Delete an automation and its runs.",
          }),
        ),
        HttpApiEndpoint.post("run", `${root}/:id/run`, {
          params: IdParams,
          query: WorkspaceRoutingQuery,
          success: described(Automation.Run, "Started run"),
          error: [ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.run",
            summary: "Run automation now",
            description: "Trigger a manual run of the automation immediately.",
          }),
        ),
        HttpApiEndpoint.get("runs", `${root}/:id/runs`, {
          params: IdParams,
          query: Schema.Struct({
            ...WorkspaceRoutingQueryFields,
            limit: Schema.optional(Schema.NumberFromString),
          }),
          success: described(Schema.Array(Automation.Run), "Recent runs"),
          error: [ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.runs",
            summary: "List automation runs",
            description: "List the most recent runs for one automation.",
          }),
        ),
        HttpApiEndpoint.post("read", `${root}/runs/read`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Runs marked as read"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "automation.read",
            summary: "Mark runs read",
            description: "Mark all automatic runs for the current project directory as read.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "automation",
          description: "Scheduled automation routes.",
        }),
      )
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
