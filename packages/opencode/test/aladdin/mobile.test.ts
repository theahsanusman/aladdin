import { request as httpsRequest } from "node:https"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void mock.module("bonjour-service", () => ({
  Bonjour: class {
    publish() {
      return { on: () => {} }
    }
    unpublishAll() {}
    destroy() {}
  },
}))

const { directory, disableMobileAccess, enableMobileAccess, mobileAccessStatus } = await import("../../src/aladdin/mobile")
const { describeCertificate, ensureCertificate, localAddresses } = await import("../../src/aladdin/tls")

const original = {
  password: Flag.OPENCODE_SERVER_PASSWORD,
  username: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}

afterEach(async () => {
  Flag.OPENCODE_SERVER_PASSWORD = original.password
  Flag.OPENCODE_SERVER_USERNAME = original.username
  process.env.OPENCODE_SERVER_PASSWORD = original.envPassword
  process.env.OPENCODE_SERVER_USERNAME = original.envUsername
  await disableMobileAccess({ passwordRequired: false, data: tmpdir() })
  await disposeAllInstances()
  await resetDatabase()
})

async function temporary() {
  return mkdtemp(path.join(tmpdir(), "aladdin-mobile-"))
}

function get(url: string, ca: string, authorization?: string) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const request = httpsRequest(url, { ca, rejectUnauthorized: true }, (response) => {
      response.resume()
      response.on("end", () => resolve({ status: response.statusCode ?? 0 }))
    })
    if (authorization) request.setHeader("authorization", authorization)
    request.on("error", reject)
    request.end()
  })
}

describe("Aladdin mobile access", () => {
  test("refuses to expose the machine until a server password is set", async () => {
    const data = await temporary()
    const status = await mobileAccessStatus({ passwordRequired: true, data })
    expect(status.enabled).toBe(false)
    expect(status.available).toBe(false)
    expect(status.reason).toBe("password-required")
    await expect(enableMobileAccess({ passwordRequired: true, data })).rejects.toThrow(/password/i)
  })

  test("reports the address and certificate a phone needs before it is enabled", async () => {
    const data = await temporary()
    const certificate = await ensureCertificate(directory(data), ["192.168.50.20"])
    const status = await mobileAccessStatus({ passwordRequired: false, data })
    expect(status.enabled).toBe(false)
    expect(status.available).toBe(true)
    expect(status.host).toMatch(/\.local$/)
    expect(status.certificateAuthority).toBe(certificate.ca)
    expect(status.url).toBeUndefined()
    expect(status.addresses).toEqual(localAddresses())
    for (const address of status.addresses) expect(address.startsWith("127.")).toBe(false)
  })

  test("serves the password protected API over the local network", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    Flag.OPENCODE_SERVER_USERNAME = "opencode"
    process.env.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
    const data = await temporary()
    const enabled = await enableMobileAccess({ passwordRequired: false, data })
    try {
      expect(enabled.enabled).toBe(true)
      expect(enabled.port).toBe(47_820)
      expect(enabled.url).toStartWith("https://")
      expect(enabled.url).toEndWith(":47820")
      expect(enabled.certificate!.names).toContain("DNS:")
      const described = await describeCertificate(path.join(directory(data), "aladdin-server.crt"))
      expect(described.names).toContain("IP Address:127.0.0.1")
      const ca = await Bun.file(enabled.certificateAuthority!).text()
      const token = encodeURIComponent(Buffer.from("opencode:mobile-secret").toString("base64"))
      expect(enabled.connectUrl).toBe(`https://${enabled.host}:47820/?auth_token=${token}`)
      const anonymous = await get("https://127.0.0.1:47820/", ca)
      expect(anonymous.status).toBe(401)
      // The link the user copies has to work with nothing else typed into the phone.
      const linked = await get(enabled.connectUrl!.replace(enabled.host, "127.0.0.1"), ca)
      expect(linked.status).toBe(200)
      const status = await get(
        "https://127.0.0.1:47820/aladdin/mobile/status",
        ca,
        `Basic ${Buffer.from("opencode:mobile-secret").toString("base64")}`,
      )
      expect(status.status).toBe(200)
    } finally {
      const disabled = await withTimeout(
        disableMobileAccess({ passwordRequired: false, data }),
        10_000,
        "timed out closing the mobile listener",
      )
      expect(disabled.enabled).toBe(false)
    }
  })
})
