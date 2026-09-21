import { Usage as UsageService } from "@opencode-ai/core/usage"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const UsageHandler = HttpApiBuilder.group(Api, "server.usage", (handlers) =>
  handlers.handle(
    "usage.summary",
    Effect.fn(function* (ctx) {
      const usage = yield* UsageService.Service
      return yield* usage.summary({ from: ctx.query.from, to: ctx.query.to })
    }),
  ),
)
