import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderError } from "@/provider/error"

describe("provider stream errors", () => {
  test("retries provider stream errors without a code", () => {
    const messages = [
      "The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing",
      "The model is temporarily unavailable.",
    ]

    for (const message of messages)
      expect(
        ProviderError.parseStreamError({
          type: "error",
          error: { message },
        }),
      ).toEqual({
        type: "api_error",
        message,
        isRetryable: true,
        responseBody: JSON.stringify({ type: "error", error: { message } }),
      })
  })
})

test("classifies Command Code's context error for compaction", () => {
  const message = "The input is longer than the model's context length trace_id: 8e2fd50cbe3067dee8ac5424be6e93b8"
  const error = new APICallError({
    message: JSON.stringify({ type: "invalid_request_error", code: "", message }),
    url: "https://api.commandcode.ai/provider/v1/responses",
    requestBodyValues: {},
    statusCode: 400,
    responseHeaders: { "content-type": "application/json" },
    responseBody: JSON.stringify({ type: "invalid_request_error", code: "", message }),
    isRetryable: false,
  })

  expect(ProviderError.parseAPICallError({ providerID: ProviderV2.ID.make("commandcode"), error })).toEqual({
    type: "context_overflow",
    message: error.message,
    responseBody: error.responseBody,
  })
})
