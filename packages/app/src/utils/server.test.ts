import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer, createSdkForServer } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("decodes UTF-8 credentials and preserves colons in the password", () => {
    expect(authFromToken("2LnZhNuMOuenmOWvhjpww6Rzc/CflJA=")).toEqual({
      username: "علی",
      password: "秘密:päss🔐",
    })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })

  test.each([
    { input: { password: "café" }, token: "b3BlbmNvZGU6Y2Fmw6k=" },
    { input: { password: "密碼🔐" }, token: "b3BlbmNvZGU65a+G56K88J+UkA==" },
    { input: { username: "علی", password: "秘密:päss🔐" }, token: "2LnZhNuMOuenmOWvhjpww6Rzc/CflJA=" },
    { input: { username: "kit", password: "ÿÿÿ" }, token: "a2l0OsO/w7/Dvw==" },
  ])("encodes UTF-8 credentials as standard padded Base64: $input", ({ input, token }) => {
    expect(authTokenFromCredentials(input)).toBe(token)
    expect(authFromToken(token)).toEqual({ username: input.username ?? "opencode", password: input.password })
  })

  test("preserves explicit empty credentials", () => {
    expect(authTokenFromCredentials({ username: "", password: "" })).toBe("Og==")
  })
})

test("authenticates both SDK generations with Unicode credentials", async () => {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json({ healthy: true, version: "test", pid: 1 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096", username: "علی", password: "秘密:päss🔐" }

  expect(await createApiForServer({ server, fetch: fetcher }).health.get()).toMatchObject({ healthy: true })
  expect((await createSdkForServer({ server, fetch: fetcher }).global.health()).data).toMatchObject({ healthy: true })
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/health", "/global/health"])
  expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
    "Basic 2LnZhNuMOuenmOWvhjpww6Rzc/CflJA=",
    "Basic 2LnZhNuMOuenmOWvhjpww6Rzc/CflJA=",
  ])
})
