import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Task } from "../src/task"

describe("Task contracts", () => {
  test("the root entrypoint exposes the canonical task schema namespace", async () => {
    const root = await import("../src/index")
    expect("Task" in root && root.Task === Task).toBe(true)
  })

  test("generated task and attempt IDs reject incomplete or wrong prefixes", () => {
    expect(Schema.decodeUnknownSync(Task.ID)(Task.ID.create())).toStartWith("tsk_")
    expect(Schema.decodeUnknownSync(Task.AttemptID)(Task.AttemptID.create())).toStartWith("tat_")
    expect(() => Schema.decodeUnknownSync(Task.ID)("tsk")).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.AttemptID)("tat")).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.ID)("tat_wrong")).toThrow()
  })

  test("dispatch and settlement reject empty, whitespace-only, or excessive text", () => {
    expect(() =>
      Schema.decodeUnknownSync(Task.Brief)({
        title: "Valid title",
        objective: " ",
        scope: [],
        output: "Report",
        checks: [],
        constraints: [],
      }),
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.Settlement)({ outcome: "completed", evidence: "" })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Task.Settlement)({ outcome: "completed", evidence: "x".repeat(20_001) }),
    ).toThrow()
  })

  test("slot and generation contracts cannot represent a fourth or unfenced worker", () => {
    expect(() => Schema.decodeUnknownSync(Task.Slot)(4)).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.Slot)(0)).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.Generation)(0)).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.Generation)(1.5)).toThrow()
  })

  test("a dispatch needs explicit scope and verification checks", () => {
    const brief = {
      title: "Work",
      objective: "Verify work",
      scope: ["This project"],
      output: "Report",
      checks: ["Tests pass"],
      constraints: [],
    }
    expect(() => Schema.decodeUnknownSync(Task.Brief)({ ...brief, scope: [] })).toThrow()
    expect(() => Schema.decodeUnknownSync(Task.Brief)({ ...brief, checks: [] })).toThrow()
  })

  test("coding mutation paths cannot represent traversal, absolute or protected configuration paths", () => {
    const execution = {
      engine: "v1",
      mode: "coding",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      maxCalls: 2,
      wallClockMs: 1000,
    }
    for (const value of [
      "../root",
      "/root",
      "C:\\root",
      "src/../../root",
      ".git/config",
      "src/.env",
      ".opencode/agent.json",
    ])
      expect(() => Schema.decodeUnknownSync(Task.Execution)({ ...execution, paths: [value] })).toThrow()
    expect(Schema.decodeUnknownSync(Task.Execution)({ ...execution, paths: ["src", "package.json"] }).paths).toEqual([
      "src",
      "package.json",
    ])
  })
})
