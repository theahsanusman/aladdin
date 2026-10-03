import { request as httpsRequest } from "node:https"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { Path } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ensureCertificate, readPem } from "../../src/aladdin/tls"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

const { Server } = await import("../../src/server/server")

const original = {
  password: Flag.OPENCODE_SERVER_PASSWORD,
  username: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = original.password
  Flag.OPENCODE_SERVER_USERNAME = original.username
  // Assigning undefined would store the literal string "undefined", which the
  // subprocess harness would forward to spawned servers and turn into a
  // non-empty required password.
  if (original.envPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
  else process.env.OPENCODE_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

// Certificates are validated strictly so the test proves what the phone will accept.
function get(url: string, ca: string, authorization?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const request = httpsRequest(url, { ca, rejectUnauthorized: true }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }))
    })
    if (authorization) request.setHeader("authorization", authorization)
    request.on("error", reject)
    request.end()
  })
}

describe("HttpApi HTTPS listener", () => {
  test("serves the API over TLS with a certificate a trusting client accepts", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    Flag.OPENCODE_SERVER_USERNAME = "opencode"
    process.env.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
    const directory = await mkdtemp(path.join(tmpdir(), "aladdin-mobile-https-"))
    const models = path.join(Path.home, "Library/Containers/com.liuliu.draw-things/Data/Documents/Models")
    await mkdir(models, { recursive: true })
    await writeFile(path.join(models, "isolated-test.safetensors"), "dummy")
    const certificate = await ensureCertificate(directory, ["192.168.50.20"])
    const listener = await Server.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: await readPem(certificate.cert), key: await readPem(certificate.key) },
    })
    try {
      expect(listener.url.protocol).toBe("https:")
      const ca = await readPem(certificate.ca)
      const anonymous = await get(`${listener.url.origin}/aladdin/status`, ca)
      expect(anonymous.status).toBe(401)
      expect(String(anonymous.headers["www-authenticate"])).toContain("Basic")
      const authorized = await get(
        `${listener.url.origin}/aladdin/status`,
        ca,
        `Basic ${Buffer.from("opencode:mobile-secret").toString("base64")}`,
      )
      expect(authorized.status).toBe(200)
      expect(JSON.parse(authorized.body).drawThingsModels).toContain("isolated-test.safetensors")
    } finally {
      await withTimeout(listener.stop(true), 10_000, "timed out stopping tls listener")
    }
  })
})
