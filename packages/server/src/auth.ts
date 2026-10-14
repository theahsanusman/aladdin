export * as ServerAuth from "./auth"

import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

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
  // A per-launch secret the desktop renderer presents instead of the user password, so the
  // password can be stored only as a hash. It never leaves the local machine and is not a
  // substitute for the password on any remote-facing listener.
  readonly desktopToken: Option.Option<string>
}

// scrypt is memory-hard, so a stolen verifier resists GPU/ASIC cracking. 16 MiB of memory per
// guess (128 * N * r) makes bulk offline attacks uneconomic while staying fast enough to verify
// interactively; repeat verifications are memoized below so per-request cost stays negligible.
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32, saltBytes: 16, maxmem: 64 * 1024 * 1024 }

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
            desktopToken: EffectConfig.string("OPENCODE_DESKTOP_TOKEN").pipe(EffectConfig.option),
          }),
        )
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function hashPassword(password: string) {
  const salt = randomBytes(SCRYPT.saltBytes)
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`
}

export function verifyPassword(password: string, stored: Option.Option<string>): boolean {
  if (Option.isNone(stored)) return false
  const parsed = parseScrypt(stored.value)
  // A scrypt verifier means the stored value is a hash (the desktop password file). Anything else
  // is a plaintext password from the environment, which is how `opencode serve` and the CLI
  // clients keep working without a separate hashing step; compare it in constant time.
  if (!parsed) return constantTimeEquals(password, stored.value)
  const derived = scryptSync(password, parsed.salt, parsed.hash.length, parsed)
  return timingSafeEqual(derived, parsed.hash)
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  if (!required(config)) return false
  if (credentials.username !== config.username) return false
  const presented = Redacted.value(credentials.password)
  // The desktop token is checked first with a constant-time compare: the renderer authenticates
  // on every request and must never pay the scrypt cost the password path incurs.
  if (
    Option.isSome(config.desktopToken) &&
    config.desktopToken.value !== "" &&
    constantTimeEquals(presented, config.desktopToken.value)
  )
    return true
  return verifyPasswordMemoized(presented, config.password)
}

// A phone re-sends its Basic credential on every request, so an uncached scrypt verify would cost
// ~100ms per request and make the app feel slow again. Memoize the result keyed by a digest of the
// stored verifier plus the presented password: a password change (new verifier) invalidates every
// entry, and looking an entry up still requires presenting the correct password.
const verifyCache = new Map<string, boolean>()
const VERIFY_CACHE_LIMIT = 64

function verifyPasswordMemoized(password: string, stored: Option.Option<string>) {
  if (Option.isNone(stored)) return false
  const key = createHash("sha256").update(stored.value).update("\0").update(password).digest("hex")
  const hit = verifyCache.get(key)
  if (hit !== undefined) return hit
  const result = verifyPassword(password, stored)
  if (verifyCache.size >= VERIFY_CACHE_LIMIT) verifyCache.clear()
  verifyCache.set(key, result)
  return result
}

function parseScrypt(stored: string) {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return
  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  if (!Number.isSafeInteger(cost) || cost < 2) return
  if (!Number.isSafeInteger(blockSize) || blockSize < 1) return
  if (!Number.isSafeInteger(parallelization) || parallelization < 1) return
  const saltBytes = Buffer.from(parts[4], "base64")
  const hashBytes = Buffer.from(parts[5], "base64")
  if (saltBytes.length === 0 || hashBytes.length === 0) return
  // Reject encodings that do not round-trip, so a mangled verifier can never be treated as valid.
  if (saltBytes.toString("base64") !== parts[4] || hashBytes.toString("base64") !== parts[5]) return
  return { N: cost, r: blockSize, p: parallelization, salt: saltBytes, hash: hashBytes }
}

function constantTimeEquals(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    // Still compare a fixed-size digest so a length mismatch costs the same as a content mismatch
    // and reveals nothing about where the two values differ.
    const digest = (value: Buffer) => createHash("sha256").update(value).digest()
    timingSafeEqual(digest(left), digest(right))
    return false
  }
  return timingSafeEqual(left, right)
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
