import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect, Exit, Schema } from "effect"
import { Agent } from "../../src/agent/agent"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { parseResponse } from "../../src/tool/mcp-websearch"
import {
  Parameters,
  WebSearchTool,
  selectWebSearchProvider,
  webSearchModelName,
  webSearchProviderLabel,
} from "../../src/tool/websearch"

import { webSearchEnabled } from "../../src/tool/registry"
import { it, testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

const permissionTests = testEffect(
  LayerNode.compile(LayerNode.group([Truncate.node, Agent.node, RuntimeFlags.node, LayerNodePlatform.httpClient])),
)

describe("websearch permission response", () => {
  const cases: Array<{
    name: string
    params: Schema.Schema.Type<typeof Parameters>
    metadata: Record<string, string | number>
  }> = [
    {
      name: "omitted livecrawl",
      params: { query: "shoe sole repair", numResults: 8 },
      metadata: { query: "shoe sole repair", numResults: 8 },
    },
    {
      name: "all options omitted",
      params: { query: "shoe sole repair" },
      metadata: { query: "shoe sole repair" },
    },
    {
      name: "explicit undefined options",
      params: { query: "shoe sole repair", livecrawl: undefined, type: undefined },
      metadata: { query: "shoe sole repair" },
    },
    {
      name: "supplied options including zero",
      params: {
        query: "shoe sole repair",
        numResults: 0,
        livecrawl: "preferred",
        type: "deep",
        contextMaxCharacters: 0,
      },
      metadata: {
        query: "shoe sole repair",
        numResults: 0,
        livecrawl: "preferred",
        type: "deep",
        contextMaxCharacters: 0,
      },
    },
  ]

  for (const item of cases) {
    permissionTests.instance(`encodes pending permissions with ${item.name}`, () =>
      Effect.gen(function* () {
        const requests: PermissionV1.Request[] = []
        const sessionID = SessionID.descending()
        const ctx: Tool.Context = {
          sessionID,
          messageID: MessageID.ascending(),
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: (input) => {
            requests.push({ ...input, sessionID, id: PermissionV1.ID.ascending() })
            return Effect.die("Search stopped at the permission boundary")
          },
        }
        const info = yield* WebSearchTool
        const tool = yield* info.init()
        const exit = yield* Effect.exit(tool.execute(item.params, ctx))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(requests).toHaveLength(1)
        // Match the permission list HTTP response's strict JSON encoding.
        const response = Schema.encodeUnknownSync(Schema.Array(PermissionV1.Request))(requests)
        expect(() => Schema.encodeUnknownSync(Schema.Json)(response)).not.toThrow()
        expect(requests[0].metadata.provider === "exa" || requests[0].metadata.provider === "parallel").toBe(true)
        expect(requests[0].metadata).toEqual({ ...item.metadata, provider: requests[0].metadata.provider })
        expect(requests[0].permission).toBe("websearch")
        expect(requests[0].patterns).toEqual([item.params.query])
        expect(requests[0].always).toEqual(["*"])
      }),
    )
  }
})

describe("websearch provider", () => {
  test("selects a stable provider per session", () => {
    expect(selectWebSearchProvider(SESSION_ID)).toBe(selectWebSearchProvider(SESSION_ID))
  })

  test("supports an operational override", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "parallel"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("parallel")

      process.env.OPENCODE_WEBSEARCH_PROVIDER = "exa"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("routes to Exa when the Exa flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: true, parallel: false })).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { exa: false, parallel: true })).toBe("parallel")
  })

  test("is enabled for OpenCode providers or explicit websearch provider flags", () => {
    expect(webSearchEnabled(ProviderV2.ID.opencode, { exa: false, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.make("opencode-go"), { exa: false, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false })).toBe(false)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: true })).toBe(true)
  })

  test("Michael research is available with every model provider", () => {
    for (const agent of ["michael", "michael-lead", "dispatcher"])
      expect(webSearchEnabled(ProviderV2.ID.make("commandcode"), { exa: false, parallel: false }, agent)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.make("commandcode"), { exa: false, parallel: false }, "build")).toBe(false)
  })

  test("uses branded labels", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
    expect(webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  test("uses the provider API model id for Parallel analytics", () => {
    expect(
      webSearchModelName({
        model: {
          id: "claude-opus-4-7",
          api: { id: "claude-opus-4.7" },
        },
      }),
    ).toBe("claude-opus-4.7")
  })
})

describe("websearch MCP response parser", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: "search results",
        },
      ],
    },
  })

  it.effect("parses plain JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(payload)
      expect(result).toBe("search results")
    }),
  )

  it.effect("parses SSE JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`event: message\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )

  it.effect("ignores non-JSON SSE data frames", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`data: [DONE]\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )
})
