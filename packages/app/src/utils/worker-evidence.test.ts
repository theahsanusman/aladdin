import { expect, test } from "bun:test"
import { workerEvidence, workerResultText } from "./worker-evidence"

test("extracts durable report and check evidence without exposing internal cleanup metadata", () => {
  const result = {
    summary: "Three worker slots",
    checks: [{ check: "Correct slot count", passed: true, evidence: "Reviewed" }],
  }
  expect(workerEvidence(JSON.stringify({ result, cleanup: "Internal implementation details" }))).toEqual(result)
  expect(workerEvidence("A plain failure explanation")).toBeUndefined()
  expect(workerEvidence(JSON.stringify({ result: { summary: "Incomplete" } }))).toBeUndefined()
})

test("keeps an unconfirmed acceptance check distinct from a rejected one", () => {
  const checks = [
    { check: "Nonempty report", passed: true, evidence: "Host inspected a nonempty 42-character report" },
    {
      check: "Rows 8 and 10 merged",
      passed: false,
      evidence: "No human confirmed this acceptance check (skipped); recorded as unverified rather than failed",
      unverified: true,
    },
    { check: "No push to origin", passed: false, evidence: "Explicit native human verification; rejected" },
  ]
  const decoded = workerEvidence(JSON.stringify({ result: { summary: "Done", checks }, cleanup: "Stopped" }))
  expect(decoded?.checks.map((check) => [check.passed, check.unverified])).toEqual([
    [true, undefined],
    [false, true],
    [false, undefined],
  ])
})

test("keeps decoding evidence recorded before unverified checks existed", () => {
  const legacy = { summary: "Older report", checks: [{ check: "Old check", passed: false, evidence: "Stale" }] }
  expect(workerEvidence(JSON.stringify({ result: legacy, cleanup: "Stopped" }))).toEqual(legacy)
})

test("keeps an unverified acceptance check distinct from a rejected one", () => {
  const checks = [
    { check: "Gates green", passed: true, evidence: "Report listed every gate" },
    { check: "Row 17 merged", passed: false, evidence: "Verification skipped", unverified: true },
    { check: "No push", passed: false, evidence: "Rejected by reviewer" },
  ]
  const decoded = workerEvidence(JSON.stringify({ result: { summary: "Merge landed", checks }, cleanup: "Stopped" }))
  expect(decoded?.checks.map((check) => [check.passed, check.unverified])).toEqual([
    [true, undefined],
    [false, true],
    [false, undefined],
  ])
})

test("distinguishes an unconfirmed check from an explicitly rejected one", () => {
  const checks = [
    { check: "Merge landed", passed: true, evidence: "Host inspected the merge commit" },
    {
      check: "Gates green",
      passed: false,
      evidence: "No human confirmed this acceptance check (skipped); recorded as unverified rather than failed",
      unverified: true,
    },
    {
      check: "No push to origin",
      passed: false,
      evidence: "Explicit native human verification; this acceptance check was rejected",
    },
  ]
  const decoded = workerEvidence(JSON.stringify({ result: { summary: "Report", checks }, cleanup: "Stopped" }))
  expect(decoded?.checks).toEqual(checks)
  expect(decoded?.checks.map((check) => check.unverified)).toEqual([undefined, true, undefined])
})

test("shows worker reports and failure reasons without internal cleanup data", () => {
  expect(workerResultText(JSON.stringify({ result: { error: "Host exited" }, cleanup: "Internal" }))).toBe(
    "Host exited",
  )
  expect(workerResultText(JSON.stringify({ error: "Too large", cleanup: "Internal" }))).toBe("Too large")
  expect(workerResultText("Request failed")).toBe("Request failed")
  expect(workerResultText(JSON.stringify({ cleanup: "Internal" }))).toBeUndefined()
})

test("keeps a worker failure readable while its full diagnostic evidence remains intact", () => {
  const text = JSON.stringify({
    result: {
      error: "TimeoutError: Worker exceeded its runtime\n    at TaskExecution.make (file:///app.asar/node.js:123)",
    },
    cleanup: "Stopped",
  })
  expect(workerResultText(text)).toBe("TimeoutError: Worker exceeded its runtime")
  expect(JSON.parse(text).result.error).toContain("file:///app.asar/node.js:123")
})
