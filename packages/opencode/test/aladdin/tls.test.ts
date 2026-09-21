import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  certificateNames,
  describeCertificate,
  ensureCertificate,
  localAddresses,
  localHostName,
  verifyCertificate,
} from "../../src/aladdin/tls"

async function temporary() {
  return mkdtemp(path.join(tmpdir(), "aladdin-tls-"))
}

describe("Aladdin mobile certificates", () => {
  test("issues a leaf certificate that verifies against its own authority", async () => {
    const directory = await temporary()
    const certificate = await ensureCertificate(directory, ["192.168.50.20"])
    expect(await verifyCertificate(certificate)).toBe(true)
  })

  test("covers the local hostname and every reachable address", async () => {
    const directory = await temporary()
    const certificate = await ensureCertificate(directory, ["192.168.50.20", "10.0.0.7"])
    const described = await describeCertificate(certificate.cert)
    expect(described.names).toContain(`DNS:${localHostName()}`)
    expect(described.names).toContain("IP Address:192.168.50.20")
    expect(described.names).toContain("IP Address:10.0.0.7")
    expect(described.names).toContain("DNS:localhost")
    expect(described.names).toContain("IP Address:127.0.0.1")
  })

  test("stays inside the validity window iOS accepts", async () => {
    const directory = await temporary()
    const certificate = await ensureCertificate(directory, ["192.168.50.20"])
    const described = await describeCertificate(certificate.cert)
    const notBefore = Date.parse(described.dates.match(/notBefore=(.+)/)![1]!)
    const notAfter = Date.parse(described.dates.match(/notAfter=(.+)/)![1]!)
    const days = (notAfter - notBefore) / 86_400_000
    expect(days).toBeLessThanOrEqual(825)
    expect(days).toBeGreaterThan(800)
  })

  test("reuses a certificate while the names it covers are unchanged", async () => {
    const directory = await temporary()
    const first = await ensureCertificate(directory, ["192.168.50.20"])
    const before = await Bun.file(first.cert).text()
    const second = await ensureCertificate(directory, ["192.168.50.20"])
    expect(await Bun.file(second.cert).text()).toBe(before)
    expect((await readdir(directory)).filter((file) => file.endsWith(".key"))).toHaveLength(2)
  })

  test("reissues a certificate when the address changes", async () => {
    const directory = await temporary()
    const first = await ensureCertificate(directory, ["192.168.50.20"])
    const before = await Bun.file(first.cert).text()
    const second = await ensureCertificate(directory, ["192.168.50.21"])
    expect(await Bun.file(second.cert).text()).not.toBe(before)
    expect(await verifyCertificate(second)).toBe(true)
  })

  test("names a stable local host so the phone survives an address change", () => {
    const names = certificateNames(["192.168.50.20"])
    expect(names.dns).toContain(localHostName())
    expect(names.dns).toContain(localHostName().replace(/\.local$/, ""))
    expect(names.ips).toContain("127.0.0.1")
    expect(names.ips).toContain("192.168.50.20")
  })

  test("ignores link-local addresses when describing this machine", () => {
    for (const address of localAddresses()) expect(address.startsWith("169.254.")).toBe(false)
  })
})
