import path from "node:path"
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
    host,
    port: input.current?.port,
    addresses: localAddresses(),
    certificateAuthority: authority,
    certificate: input.current?.certificate,
  }
}

// The phone reaches this Mac over the local network, where the microphone only exists in a secure
// context. The listener therefore refuses to start unless the server is password protected: an
// unauthenticated HTTPS endpoint on the local network would hand control of this machine to anyone
// on the same Wi-Fi.
export async function mobileAccessStatus(input: { passwordRequired: boolean; data: string }): Promise<MobileStatus> {
  return statusFor({ ...input, current: running })
}

export async function enableMobileAccess(input: { passwordRequired: boolean; data: string }): Promise<MobileStatus> {
  if (input.passwordRequired) throw new Error("Set a server password before enabling mobile access")
  if (running) return statusFor({ ...input, current: running })
  const certificate = await ensureCertificate(directory(input.data))
  if (!(await verifyCertificate(certificate))) throw new Error("Generated certificate could not be verified")
  const { Server } = await import("@/server/server")
  const started = await Server.listen({
    hostname: "0.0.0.0",
    port: MOBILE_PORT,
    mdns: true,
    mdnsDomain: localHostName().replace(/\.local$/, ""),
    serveWebUI: true,
    tls: { cert: await readPem(certificate.cert), key: await readPem(certificate.key) },
  })
  running = {
    port: started.port,
    certificateAuthority: certificate.ca,
    certificate: await describeCertificate(certificate.cert),
  }
  listener = { stop: (close?: boolean) => started.stop(close) }
  return statusFor({ ...input, current: running })
}

export async function disableMobileAccess(input: { passwordRequired: boolean; data: string }): Promise<MobileStatus> {
  const current = listener
  running = undefined
  listener = undefined
  if (current) await current.stop(true).catch(() => undefined)
  return statusFor(input)
}
