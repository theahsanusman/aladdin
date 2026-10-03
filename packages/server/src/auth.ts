export * as ServerAuth from "./auth"

import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@opencode/ServerAuthConfig") {
  static configLayer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get layer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        return Config.of(
          yield* EffectConfig.all({
            password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
            username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("opencode")),
          }),
        )
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return (
    Option.isSome(config.password) &&
    credentials.username === config.username &&
    Redacted.value(credentials.password) === config.password.value
  )
}

const BROWSER_COOKIE = "aladdin_browser"

export function browserCookie(config: Info) {
  const nonce = randomBytes(16).toString("hex")
  return `${BROWSER_COOKIE}=${nonce}.${browserSignature(nonce, config)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`
}

export function browserAuthorized(headers: Readonly<Record<string, string | undefined>>, config: Info) {
  if (!required(config)) return false
  // A same-site sibling origin must not gain control using an ambient cookie.
  if (headers["sec-fetch-site"] && !["same-origin", "none"].includes(headers["sec-fetch-site"])) return false
  if (headers.origin) {
    if (!URL.canParse(headers.origin) || new URL(headers.origin).host !== headers.host) return false
  }
  const value = headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${BROWSER_COOKIE}=`))
    ?.slice(BROWSER_COOKIE.length + 1)
  if (!value || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return false
  const [nonce, signature] = value.split(".")
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(browserSignature(nonce, config), "hex"))
}

function browserSignature(nonce: string, config: Info) {
  return createHmac(
    "sha256",
    Option.getOrElse(config.password, () => ""),
  )
    .update(`${BROWSER_COOKIE}:${config.username}:${nonce}`)
    .digest("hex")
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
