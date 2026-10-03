import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { Path } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import {
  certificateExists,
  describeCertificate,
  ensureCertificate,
  localAddresses,
  localHostName,
  readPem,
  verifyCertificate,
} from "./tls"

const MOBILE_PORT = 47_820

export type MobileStatus = {
  enabled: boolean
  available: boolean
  reason?: "password-required"
  url?: string
  connectUrl?: string
  localUrl?: string
  localConnectUrl?: string
  host: string
  port?: number
  addresses: string[]
  certificateAuthority?: string
  certificate?: { names: string; dates: string }
}

type Running = {
  port: number
  certificateAuthority: string
  certificate: { names: string; dates: string }
}

let running: Running | undefined
let listener: { stop: (close?: boolean) => Promise<void> } | undefined
let changing = Promise.resolve()

function change<A>(operation: () => Promise<A>): Promise<A> {
  const next = changing.then(operation)
  changing = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export function directory(data: string) {
  return path.join(data, "aladdin", "mobile")
}

// The phone cannot type Basic credentials comfortably, and the security middleware already accepts the
// same credentials as an `auth_token` query parameter. Embedding them in the link is not an escalation:
// only a caller that already authenticated with the server password can read this response.
function connectToken() {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return
  return Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")
}

export function mobilePasswordRequired() {
  return !Flag.OPENCODE_SERVER_PASSWORD && process.env.ALADDIN_ALLOW_UNAUTHENTICATED_LAN !== "1"
}

function statusFor(input: { passwordRequired: boolean; data: string; current?: Running }): MobileStatus {
  const authority = input.current?.certificateAuthority ?? certificateExists(directory(input.data))
  const host = localHostName()
  const token = input.current ? connectToken() : undefined
  return {
    enabled: !!input.current,
    available: !input.passwordRequired,
    reason: input.passwordRequired ? "password-required" : undefined,
    url: input.current ? `https://${host}:${input.current.port}` : undefined,
    connectUrl:
      input.current && token
        ? `https://${host}:${input.current.port}/?auth_token=${encodeURIComponent(token)}`
        : undefined,
    localUrl: input.current ? `https://localhost:${input.current.port}` : undefined,
    localConnectUrl:
      input.current && token
        ? `https://localhost:${input.current.port}/?auth_token=${encodeURIComponent(token)}`
        : undefined,
    host,
    port: input.current?.port,
    addresses: localAddresses(),
    certificateAuthority: authority,
    certificate: input.current?.certificate,
  }
}

// The phone reaches this Mac over the local network, where the microphone only exists in a secure
// context. Password protection is the default; desktop users may explicitly opt into passwordless
// LAN control. That preference grants access to every device that can reach this listener.
export async function mobileAccessStatus(input: { passwordRequired: boolean; data: string }): Promise<MobileStatus> {
  return statusFor({ ...input, current: running })
}

export async function restoreMobileAccess(
  data = Path.data,
  options: { enabledByDefault?: boolean; port?: number } = {},
): Promise<MobileStatus> {
  const input = { passwordRequired: mobilePasswordRequired(), data, port: options.port }
  const saved = await readFile(path.join(directory(data), "access.enabled"), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  })
  const enabled = saved === "enabled" || (saved === undefined && options.enabledByDefault)
  return enabled && !input.passwordRequired ? enableMobileAccess(input) : mobileAccessStatus(input)
}

export function enableMobileAccess(input: {
  passwordRequired: boolean
  data: string
  port?: number
}): Promise<MobileStatus> {
  return change(() => enable(input))
}

async function enable(input: { passwordRequired: boolean; data: string; port?: number }): Promise<MobileStatus> {
  if (input.passwordRequired) throw new Error("Set a server password before enabling mobile access")
  if (running) return statusFor({ ...input, current: running })
  const certificate = await ensureCertificate(directory(input.data))
  if (!(await verifyCertificate(certificate))) throw new Error("Generated certificate could not be verified")
  // Complete certificate inspection before opening a socket. A failed inspection
  // must not leave an untracked listener that blocks the next enable attempt.
  const description = await describeCertificate(certificate.cert)
  const { Server } = await import("@/server/server")
  const started = await Server.listen({
    hostname: "0.0.0.0",
    port: input.port ?? MOBILE_PORT,
    mdns: true,
    mdnsDomain: localHostName().replace(/\.local$/, ""),
    serveWebUI: true,
    tls: { cert: await readPem(certificate.cert), key: await readPem(certificate.key) },
  })
  await writeFile(path.join(directory(input.data), "access.enabled"), "enabled", { mode: 0o600 }).catch(
    async (error) => {
      await started.stop(true)
      throw error
    },
  )
  running = {
    port: started.port,
    certificateAuthority: certificate.ca,
    certificate: description,
  }
  listener = { stop: (close?: boolean) => started.stop(close) }
  return statusFor({ ...input, current: running })
}

export function disableMobileAccess(input: { passwordRequired: boolean; data: string }): Promise<MobileStatus> {
  return change(() => disable(input))
}

async function disable(input: { passwordRequired: boolean; data: string }): Promise<MobileStatus> {
  await mkdir(directory(input.data), { recursive: true })
  await writeFile(path.join(directory(input.data), "access.enabled"), "disabled", { mode: 0o600 })
  const current = listener
  running = undefined
  listener = undefined
  if (current) await current.stop(true).catch(() => undefined)
  return statusFor(input)
}
