export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "@opencode-ai/server/auth"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export class Config extends ConfigService.Service<Config>()("@opencode/ServerAuthConfig", {
  password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
  username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("opencode")),
  desktopToken: EffectConfig.string("OPENCODE_DESKTOP_TOKEN").pipe(EffectConfig.option),
}) {}

export type Info = Context.Service.Shape<typeof Config>

// The password is stored only as a scrypt verifier, and the desktop renderer presents a per-launch
// token instead of the password, so both checks live in the shared server-auth package. This
// module keeps the same shape and delegates rather than re-implementing the comparison.
export function required(config: Info) {
  return ServerAuth.required(config)
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return ServerAuth.authorized(credentials, config)
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  const username = credentials?.username ?? Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
