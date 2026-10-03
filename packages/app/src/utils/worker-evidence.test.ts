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

test("shows worker reports and failure reasons without internal cleanup data", () => {
  expect(workerResultText(JSON.stringify({ result: { error: "Host exited" }, cleanup: "Internal" }))).toBe(
    "Host exited",
  )
  expect(workerResultText(JSON.stringify({ error: "Too large", cleanup: "Internal" }))).toBe("Too large")
  expect(workerResultText("Request failed")).toBe("Request failed")
  expect(workerResultText(JSON.stringify({ cleanup: "Internal" }))).toBeUndefined()
})
