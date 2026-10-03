import { expect, test } from "bun:test"
import { makeDefaultApi } from "../src/api"
import { Authorization } from "../src/middleware/authorization"

test("the public protocol exposes chat-owned task controls", () => {
  const api = makeDefaultApi({ locationMiddleware: Authorization, sessionLocationMiddleware: Authorization })
  expect(Object.keys(api.groups)).toContain("server.task")
})
