import { Effect } from "effect"
import { HttpEffect, HttpRouter, HttpServerResponse } from "effect/unstable/http"

// effect-smol's HttpMiddleware.cors builds OPTIONS preflight responses by
// spreading allowOrigin() and allowHeaders() into the same record. Both set
// the `vary` key, so allowHeaders' `Vary: Access-Control-Request-Headers`
// overwrites allowOrigin's `Vary: Origin`. With dynamic origin echoing, the
// missing `Vary: Origin` lets shared caches reuse a preflight cached for one
// origin against a different origin.
//
// TODO: upstream a fix that merges Vary values in headersFromRequestOptions
// (packages/effect/src/unstable/http/HttpMiddleware.ts ~line 332).
export const corsVaryFix = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const response = yield* effect
      // Normal CORS headers are applied in a pre-response hook, after router
      // middleware. Merge at the same boundary, preserving content negotiation
      // even when this particular request received an uncompressed body.
      yield* HttpEffect.appendPreResponseHandler((_, finalResponse) => {
        const origin = finalResponse.headers["access-control-allow-origin"]
        const tokens = [
          response.headers.vary,
          finalResponse.headers.vary,
          origin && origin !== "*" ? "Origin" : undefined,
        ]
          .filter((value): value is string => value !== undefined)
          .flatMap((value) => value.split(","))
          .map((value) => value.trim())
          .filter(Boolean)
        if (tokens.length === 0) return Effect.succeed(finalResponse)
        const vary = tokens.includes("*")
          ? "*"
          : tokens
              .filter(
                (token, index) => tokens.findIndex((value) => value.toLowerCase() === token.toLowerCase()) === index,
              )
              .join(", ")
        return Effect.succeed(HttpServerResponse.setHeader(finalResponse, "vary", vary))
      })
      return response
    }),
  { global: true },
)
