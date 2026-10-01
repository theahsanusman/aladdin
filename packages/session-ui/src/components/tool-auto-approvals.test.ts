import { describe, expect, test } from "bun:test"
import { readAutoApprovals } from "./tool-auto-approvals"

describe("readAutoApprovals", () => {
  test("preserves confirmed rule and auto records without changing actions or resources", () => {
    const resources = Object.freeze(["/project/src/index.ts", "C:\\work\\تقرير.txt"])
    const metadata = Object.freeze({
      autoApprovals: Object.freeze([
        Object.freeze({ action: "read", resources, reason: "rule" }),
        Object.freeze({ action: "shell", resources: Object.freeze(["bun test"]), reason: "auto" }),
        Object.freeze({ action: "custom_action", resources: Object.freeze([]), reason: "auto" }),
      ]),
    })

    expect(readAutoApprovals(metadata)).toEqual([
      { action: "read", resources: ["/project/src/index.ts", "C:\\work\\تقرير.txt"], reason: "rule" },
      { action: "shell", resources: ["bun test"], reason: "auto" },
      { action: "custom_action", resources: [], reason: "auto" },
    ])
    expect(metadata.autoApprovals[0]?.resources).toEqual(["/project/src/index.ts", "C:\\work\\تقرير.txt"])
  })

  test.each(
    [
      undefined,
      null,
      false,
      "auto",
      [],
      {},
      { autoApprovals: undefined },
      { autoApprovals: null },
      { autoApprovals: {} },
      { autoApprovals: "read" },
      { autoApprovals: [] },
      { action: "read", resources: ["/project"], reason: "auto" },
      { tool: "read", mode: "auto", approved: true },
      { permission: { action: "read", resources: ["/project"], reason: "auto" } },
    ].map((metadata) => [metadata] as const),
  )("does not invent an approval from unrecorded metadata %j", (metadata) => {
    expect(readAutoApprovals(metadata)).toEqual([])
  })

  test.each(
    [
      null,
      false,
      [],
      "read",
      {},
      { resources: ["/project"], reason: "rule" },
      { action: 1, resources: ["/project"], reason: "rule" },
      { action: "", resources: ["/project"], reason: "rule" },
      { action: " \n\t ", resources: ["/project"], reason: "rule" },
      { action: "read", reason: "rule" },
      { action: "read", resources: "/project", reason: "rule" },
      { action: "read", resources: ["/project", 1], reason: "rule" },
      { action: "read", resources: [null], reason: "rule" },
      { action: "read", resources: [""], reason: "rule" },
      { action: "read", resources: [" \n "], reason: "rule" },
      { action: "read", resources: ["/project"] },
      { action: "read", resources: ["/project"], reason: "manual" },
      { action: "read", resources: ["/project"], reason: true },
    ].map((record) => [record] as const),
  )("rejects the whole malformed record %j", (record) => {
    expect(readAutoApprovals({ autoApprovals: [record] })).toEqual([])
  })

  test("keeps valid records in order when adjacent records are malformed", () => {
    expect(
      readAutoApprovals({
        autoApprovals: [
          null,
          { action: "read", resources: ["/project/a.ts"], reason: "rule" },
          { action: "write", resources: ["/project/b.ts"], reason: "manual" },
          { action: "external_directory", resources: ["/tmp/review"], reason: "auto" },
        ],
      }),
    ).toEqual([
      { action: "read", resources: ["/project/a.ts"], reason: "rule" },
      { action: "external_directory", resources: ["/tmp/review"], reason: "auto" },
    ])
  })

  test("rejects sparse resources rather than treating missing entries as confirmed strings", () => {
    expect(readAutoApprovals({ autoApprovals: [{ action: "read", resources: Array(1), reason: "auto" }] })).toEqual([])
  })
})
