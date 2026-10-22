import { expect, test } from "bun:test"
import { retry } from "./retry"

test("retries a browser network failure wrapped by the current API client", async () => {
  let attempts = 0
  const result = await retry(
    async () => {
      attempts++
      if (attempts === 1) throw new Error("Transport", { cause: new TypeError("Load failed") })
      return "ready"
    },
    { delay: 0 },
  )
  expect(result).toBe("ready")
  expect(attempts).toBe(2)
})

test("does not retry a wrapped validation error", async () => {
  let attempts = 0
  const error = new Error("Transport", { cause: new Error("Invalid configuration") })
  await expect(
    retry(
      async () => {
        attempts++
        throw error
      },
      { delay: 0 },
    ),
  ).rejects.toBe(error)
  expect(attempts).toBe(1)
})

test("stops traversing a cyclic error cause", async () => {
  const error = new Error("Transport")
  Object.defineProperty(error, "cause", { value: error })
  await expect(
    retry(
      async () => {
        throw error
      },
      { delay: 0 },
    ),
  ).rejects.toBe(error)
})
