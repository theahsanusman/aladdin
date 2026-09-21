import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { hostname as systemHostName, networkInterfaces } from "node:os"
import path from "node:path"

const CA_DAYS = 3_650
// Apple rejects TLS server certificates with a validity longer than 825 days, including ones issued
// by a certificate authority the user installed by hand on the phone.
const LEAF_DAYS = 825

export type Certificate = {
  directory: string
  ca: string
  caKey: string
  cert: string
  key: string
}

export function localAddresses() {
  const result: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== "IPv4") continue
      if (entry.address.startsWith("169.254.")) continue
      result.push(entry.address)
    }
  }
  return [...new Set(result)].sort()
}

export function localHostName() {
  const raw = process.env.ALADDIN_MOBILE_HOSTNAME ?? systemHostName()
  const short = (raw.split(".")[0] || "aladdin").replace(/[^A-Za-z0-9-]/g, "")
  return `${short || "aladdin"}.local`
}

// A phone will not grant microphone access to an untrusted origin, so the certificate has to be
// trusted rather than clicked through: a private certificate authority plus a leaf certificate that
// carries every name the device might use to reach this Mac. `.local` is included so the phone keeps
// working after the router hands out a new address, and each current address is included because
// Bonjour resolution is not always available.
export function certificateNames(addresses = localAddresses()) {
  const host = localHostName()
  const dns = [...new Set([host, host.replace(/\.local$/, ""), "localhost"])].filter(Boolean)
  const ips = [...new Set(["127.0.0.1", ...addresses])]
  return { dns, ips }
}

export async function ensureCertificate(directory: string, addresses?: string[]): Promise<Certificate> {
  const files = {
    directory,
    ca: path.join(directory, "aladdin-ca.crt"),
    caKey: path.join(directory, "aladdin-ca.key"),
    cert: path.join(directory, "aladdin-server.crt"),
    key: path.join(directory, "aladdin-server.key"),
  }
  const names = certificateNames(addresses)
  const wanted = [...names.dns.map((name) => `DNS:${name}`), ...names.ips.map((ip) => `IP:${ip}`)].join(",")
  const stamp = path.join(directory, "aladdin-server.names")
  const current = existsSync(stamp) ? (await readFile(stamp, "utf8").catch(() => "")).trim() : ""
  const complete = existsSync(files.cert) && existsSync(files.key) && existsSync(files.ca)
  if (complete && current === wanted) return files

  await mkdir(directory, { recursive: true })
  await rm(files.cert, { force: true })
  await rm(files.key, { force: true })

  const work = path.join(directory, "work")
  await mkdir(work, { recursive: true })
  const caConfig = path.join(work, "ca.cnf")
  const leafConfig = path.join(work, "leaf.cnf")
  await writeFile(
    caConfig,
    ["[req]", "distinguished_name = dn", "prompt = no", "[dn]", "CN = Aladdin Local CA", "[ext]", "basicConstraints = critical,CA:TRUE", "keyUsage = critical,keyCertSign,cRLSign", ""].join("\n"),
  )
  await writeFile(
    leafConfig,
    [
      "basicConstraints = critical,CA:FALSE",
      "keyUsage = critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage = serverAuth",
      `subjectAltName = ${wanted}`,
      "",
    ].join("\n"),
  )

  if (!existsSync(files.ca) || !existsSync(files.caKey)) {
    await openssl([
      "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
      "-days", String(CA_DAYS), "-keyout", files.caKey, "-out", files.ca,
      "-config", caConfig, "-extensions", "ext",
    ])
  }

  const csr = path.join(work, "server.csr")
  await openssl([
    "req", "-new", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-keyout", files.key, "-out", csr, "-subj", "/CN=Aladdin Local Server",
  ])
  await openssl([
    "x509", "-req", "-sha256", "-in", csr, "-CA", files.ca, "-CAkey", files.caKey,
    "-CAcreateserial", "-out", files.cert, "-days", String(LEAF_DAYS), "-extfile", leafConfig,
  ])
  await rm(work, { recursive: true, force: true })
  await rm(path.join(directory, "aladdin-ca.srl"), { force: true })
  await writeFile(stamp, wanted)
  return files
}

export async function verifyCertificate(certificate: Certificate) {
  return (await openssl(["verify", "-CAfile", certificate.ca, certificate.cert])).includes(": OK")
}

export async function describeCertificate(file: string) {
  const names = await openssl(["x509", "-in", file, "-noout", "-ext", "subjectAltName"])
  const dates = await openssl(["x509", "-in", file, "-noout", "-dates"])
  return { names: names.trim(), dates: dates.trim() }
}

export function readPem(file: string) {
  return readFile(file, "utf8")
}

export function certificateExists(directory: string) {
  const file = path.join(directory, "aladdin-ca.crt")
  return existsSync(file) ? file : undefined
}

async function openssl(args: string[]) {
  const binary = process.env.ALADDIN_OPENSSL ?? "openssl"
  const child = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`openssl ${args[0]} failed: ${stderr.trim() || `exit ${code}`}`)
  return stdout
}
