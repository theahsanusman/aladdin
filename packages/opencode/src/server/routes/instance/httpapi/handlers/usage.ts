import { Usage as UsageService } from "@opencode-ai/core/usage"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const usageHandlers = HttpApiBuilder.group(InstanceHttpApi, "usage", (handlers) =>
  handlers.handle(
    "summary",
    Effect.fn(function* (ctx) {
      const usage = yield* UsageService.Service
      return yield* usage.summary({ from: ctx.query.from, to: ctx.query.to })
    }),
  ),
)
