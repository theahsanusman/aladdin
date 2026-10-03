import { expect, test } from "bun:test"
import { workerNotice, workerResultArrived } from "./worker-notice"

test("worker notices refresh only their exact owning chat", () => {
  expect(workerNotice({ type: "task.changed", properties: { sessionID: "a" } }, "a")).toBe(true)
  expect(workerNotice({ type: "task.team.changed", properties: { sessionID: "a" } }, "a")).toBe(true)
  expect(workerNotice({ type: "task.changed", properties: { sessionID: "b" } }, "a")).toBe(false)
  expect(workerNotice({ type: "task.changed", properties: null }, "a")).toBe(false)
  expect(workerNotice({ type: "message.updated", properties: { sessionID: "a" } }, "a")).toBe(false)
  expect(workerNotice({ type: "task.changed", properties: { sessionID: "a" } })).toBe(false)
})

test("terminal worker results are surfaced once, including existing results and failures", () => {
  const result = { task: { id: "task", status: "completed" }, evidence: "Actual result" }
  expect(workerResultArrived([], [result])).toBe(true)
  expect(
    workerResultArrived([{ ...result, task: { ...result.task, status: "running" }, evidence: undefined }], [result]),
  ).toBe(true)
  expect(workerResultArrived([result], [result])).toBe(false)
  expect(workerResultArrived([], [{ ...result, task: { ...result.task, status: "running" } }])).toBe(false)
  expect(workerResultArrived([], [{ ...result, evidence: undefined }])).toBe(false)
  expect(workerResultArrived([], [{ ...result, task: { ...result.task, status: "failed" } }])).toBe(true)
})
