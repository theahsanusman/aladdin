import { expect, test } from "bun:test"
import { runtimeEpoch, runtimeHostAlive } from "../src/task/runtime-host"

test("host identity recognizes its own live process without sending a signal", () => {
  expect(runtimeHostAlive(runtimeEpoch())).toBe(true)
  expect(runtimeHostAlive(`local:2147483647:${crypto.randomUUID()}`)).toBe(false)
})
test("legacy, malformed and impossible process identities remain unknown", () => {
  for (const epoch of ["old-epoch", "local:0:abc", `local:2147483648:${crypto.randomUUID()}`])
    expect(runtimeHostAlive(epoch)).toBeUndefined()
})
