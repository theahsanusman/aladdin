import { expect, test } from "bun:test"
import { Schema } from "effect"
import { TaskInteraction } from "../src/task-interaction"

test("preserves opaque native JSON fields without interpreting a V1 permission as a current request", () => {
  const input = {
    kind: "permission",
    format: "v1",
    generation: 1,
    timeCreated: 10,
    expiresAt: 300_010,
    payload: {
      id: "per_original",
      sessionID: "ses_worker",
      permission: "bash",
      patterns: ["git status"],
      always: ["git *"],
      metadata: { nested: [null, true, { command: "git status" }] },
      tool: { messageID: "msg_original", callID: "call_original" },
      futureNativeField: { retained: true },
    },
  } satisfies TaskInteraction.Open
  expect(Schema.decodeUnknownSync(TaskInteraction.Open)(input)).toEqual(input)
})

test("requires an explicit permission expiry and rejects non-JSON payload values", () => {
  expect(() =>
    Schema.decodeUnknownSync(TaskInteraction.Open)({
      kind: "permission",
      format: "current",
      generation: 1,
      timeCreated: 10,
      payload: {},
    }),
  ).toThrow()
  expect(() =>
    Schema.decodeUnknownSync(TaskInteraction.Open)({
      kind: "question",
      format: "current",
      generation: 1,
      timeCreated: 10,
      payload: { lost: undefined },
    }),
  ).toThrow()
})

test("question expiry is optional and permission decisions retain correction and automatic markers", () => {
  const input = {
    kind: "question",
    format: "current",
    generation: 1,
    timeCreated: 10,
    payload: {},
  } satisfies TaskInteraction.Open
  expect(Schema.encodeSync(TaskInteraction.Open)(Schema.decodeUnknownSync(TaskInteraction.Open)(input))).toEqual(input)
  expect(
    Schema.decodeUnknownSync(TaskInteraction.Decision)({
      kind: "permission",
      reply: "reject",
      message: "Use a read-only command",
      automatic: false,
    }),
  ).toEqual({ kind: "permission", reply: "reject", message: "Use a read-only command", automatic: false })
})

test("rejects objects that JSON serialization would transform or silently discard", () => {
  const input = { kind: "question", format: "current", generation: 1, timeCreated: 10 }
  expect(() => Schema.decodeUnknownSync(TaskInteraction.Open)({ ...input, payload: { metadata: { date: new Date(0) } } })).toThrow()
  expect(() => Schema.decodeUnknownSync(TaskInteraction.Open)({ ...input, payload: new Map([["id", "per_original"]]) })).toThrow()
})
