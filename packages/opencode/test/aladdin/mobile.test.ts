import { request as httpsRequest } from "node:https"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
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

const { directory, disableMobileAccess, enableMobileAccess, mobileAccessStatus, restoreMobileAccess } = await import(
  "../../src/aladdin/mobile"
)
const { describeCertificate, ensureCertificate, localAddresses } = await import("../../src/aladdin/tls")

const original = {
  password: Flag.OPENCODE_SERVER_PASSWORD,
  username: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
  unauthenticated: process.env.ALADDIN_ALLOW_UNAUTHENTICATED_LAN,
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
  if (original.unauthenticated === undefined) delete process.env.ALADDIN_ALLOW_UNAUTHENTICATED_LAN
  else process.env.ALADDIN_ALLOW_UNAUTHENTICATED_LAN = original.unauthenticated
  await disableMobileAccess({ passwordRequired: false, data: tmpdir() })
  await disposeAllInstances()
  await resetDatabase()
})

async function temporary() {
  return mkdtemp(path.join(tmpdir(), "aladdin-mobile-"))
}

function get(url: string, ca: string, authorization?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const deadline = setTimeout(() => request.destroy(new Error(`Mobile HTTPS request timed out: ${url}`)), 3_000)
    const request = httpsRequest(url, { ca, rejectUnauthorized: true }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        clearTimeout(deadline)
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
      })
    })
    if (authorization) request.setHeader("authorization", authorization)
    request.on("error", (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    request.end()
  })
}

describe("Aladdin mobile access", () => {
  test("explicit desktop passwordless mode restores HTTPS without a login challenge", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = ""
    process.env.OPENCODE_SERVER_PASSWORD = ""
    process.env.ALADDIN_ALLOW_UNAUTHENTICATED_LAN = "1"
    const data = await temporary()
    const status = await restoreMobileAccess(data, { enabledByDefault: true, port: 0 })
    expect(status.enabled).toBe(true)
    expect(status.available).toBe(true)
    const ca = await readFile(status.certificateAuthority!, "utf8")
    const response = await get(`https://127.0.0.1:${status.port}/global/health`, ca)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).healthy).toBe(true)
  }, 30_000)

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

  test.skipIf(process.platform === "win32")("certificate inspection failure leaves no listening socket", async () => {
    const data = await temporary()
    const binary = path.join(data, "openssl")
    await writeFile(
      binary,
      '#!/bin/sh\ncase "$*" in *"-noout -text"*) echo "Inspection failed" >&2; exit 1 ;; esac\nexec /usr/bin/openssl "$@"\n',
      { mode: 0o700 },
    )
    const original = process.env.ALADDIN_OPENSSL
    const reserved = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("test") })
    const port = reserved.port
    await reserved.stop(true)
    process.env.ALADDIN_OPENSSL = binary
    try {
      await expect(enableMobileAccess({ passwordRequired: false, data, port })).rejects.toThrow("Inspection failed")
      const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("test") })
      await probe.stop(true)
    } finally {
      if (original === undefined) delete process.env.ALADDIN_OPENSSL
      else process.env.ALADDIN_OPENSSL = original
    }
  })

  test("serves the password protected API over the local network", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    Flag.OPENCODE_SERVER_USERNAME = "opencode"
    process.env.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
    const data = await temporary()
    const enabled = await enableMobileAccess({ passwordRequired: false, data, port: 0 })
    try {
      expect(enabled.enabled).toBe(true)
      expect(enabled.port).toBeGreaterThan(0)
      expect(enabled.url).toStartWith("https://")
      expect(enabled.url).toEndWith(`:${enabled.port}`)
      expect(enabled.certificate!.names).toContain("DNS:")
      const described = await describeCertificate(path.join(directory(data), "aladdin-server.crt"))
      expect(described.names).toContain("IP Address:127.0.0.1")
      const ca = await Bun.file(enabled.certificateAuthority!).text()
      const token = encodeURIComponent(Buffer.from("opencode:mobile-secret").toString("base64"))
      expect(enabled.connectUrl).toBe(`https://${enabled.host}:${enabled.port}/?auth_token=${token}`)
      const anonymous = await get(`https://127.0.0.1:${enabled.port}/`, ca)
      expect(anonymous.status).toBe(401)
      // The link the user copies has to work with nothing else typed into the phone.
      const linked = await get(enabled.connectUrl!.replace(enabled.host, "127.0.0.1"), ca)
      expect(linked.status).toBe(200)
      const status = await get(
        `https://127.0.0.1:${enabled.port}/aladdin/mobile/status`,
        ca,
        `Basic ${Buffer.from("opencode:mobile-secret").toString("base64")}`,
      )
      expect(status.status).toBe(200)
      expect(JSON.parse(status.body)).toMatchObject({
        localUrl: `https://localhost:${enabled.port}`,
        localConnectUrl: `https://localhost:${enabled.port}/?auth_token=${token}`,
        connectUrl: enabled.connectUrl,
      })
      for (const address of enabled.addresses) {
        const lan = await get(
          `https://${address}:${enabled.port}/aladdin/mobile/status`,
          ca,
          `Basic ${Buffer.from("opencode:mobile-secret").toString("base64")}`,
        )
        expect(lan.status).toBe(200)
      }
    } finally {
      const disabled = await withTimeout(
        disableMobileAccess({ passwordRequired: false, data }),
        10_000,
        "timed out closing the mobile listener",
      )
      expect(disabled.enabled).toBe(false)
    }
  }, 30_000)

  test("concurrent controllers share one listener and a following disable closes it", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    process.env.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    const input = { passwordRequired: false, data: await temporary(), port: 0 }
    const enabled = await Promise.all([enableMobileAccess(input), enableMobileAccess(input)])
    expect(enabled[0].port).toBeGreaterThan(0)
    expect(enabled[1].port).toBe(enabled[0].port)
    const changed = await Promise.all([enableMobileAccess(input), disableMobileAccess(input)])
    expect(changed[1].enabled).toBe(false)
    const probe = Bun.serve({ hostname: "127.0.0.1", port: enabled[0].port, fetch: () => new Response("closed") })
    await probe.stop(true)
  }, 30_000)

  test("desktop starts Wi-Fi by default with one local/LAN login, but preserves explicit disable", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    process.env.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    const data = await temporary()
    const options = { enabledByDefault: true, port: 0 }
    const status = await restoreMobileAccess(data, options)
    expect(status.enabled).toBe(true)
    expect(status.localUrl).toBe(`https://localhost:${status.port}`)
    const token = encodeURIComponent(Buffer.from("opencode:mobile-secret").toString("base64"))
    expect(status.localConnectUrl).toBe(`${status.localUrl}/?auth_token=${token}`)
    expect(status.connectUrl).toEndWith(`/?auth_token=${token}`)
    const ca = await Bun.file(status.certificateAuthority!).text()
    const connected = await get(status.localConnectUrl!.replace("localhost", "127.0.0.1"), ca)
    expect(connected.status).toBe(200)
    await disableMobileAccess({ passwordRequired: false, data })
    expect((await restoreMobileAccess(data, options)).enabled).toBe(false)
  }, 30_000)

  test("restores an explicitly enabled Wi-Fi listener, but never enables an unconfigured host", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    process.env.OPENCODE_SERVER_PASSWORD = "mobile-secret"
    const input = { passwordRequired: false, data: await temporary(), port: 0 }
    expect((await restoreMobileAccess(input.data, { port: 0 })).enabled).toBe(false)
    await enableMobileAccess(input)
    const saved = await readFile(path.join(directory(input.data), "access.enabled"), "utf8")
    expect(saved).toBe("enabled")
    await disableMobileAccess(input)
    expect(await readFile(path.join(directory(input.data), "access.enabled"), "utf8")).toBe("disabled")
    // Reproduce an enabled preference retained when the previous host exited.
    await writeFile(path.join(directory(input.data), "access.enabled"), saved)
    expect((await restoreMobileAccess(input.data, { port: 0 })).enabled).toBe(true)
    await disableMobileAccess(input)
    await writeFile(path.join(directory(input.data), "access.enabled"), saved)
    Flag.OPENCODE_SERVER_PASSWORD = ""
    process.env.OPENCODE_SERVER_PASSWORD = ""
    expect((await restoreMobileAccess(input.data, { port: 0 })).enabled).toBe(false)
  }, 30_000)
})
