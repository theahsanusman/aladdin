import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
  readonly profiles: (providerID: string) => Effect.Effect<{
    personal: boolean
    company: boolean
    personalIdentity?: string
    companyIdentity?: string
    active?: "personal" | "company"
  }, AuthError>
  readonly saveProfile: (providerID: string, profile: "personal" | "company") => Effect.Effect<void, AuthError>
  readonly activateProfile: (providerID: string, profile: "personal" | "company") => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      if (norm === "openai" && info.type === "oauth" && data.openai?.type === "oauth" && info.accountId && info.accountId === data.openai.accountId) {
        for (const profile of ["personal", "company"] as const) {
          const stored = data[`openai::aladdin-profile::${profile}`]
          if (!stored || JSON.stringify(stored) !== JSON.stringify(data.openai)) continue
          data[`openai::aladdin-profile::${profile}`] = info
          break
        }
      }
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const profileKey = (providerID: string, profile: "personal" | "company") =>
      `${providerID}::aladdin-profile::${profile}`

    const identity = (info: Info | undefined) => {
      if (info?.type !== "oauth") return undefined
      if (info.email) return `Email: ${info.email}`
      if (info.accountId) return `Account ID: ${info.accountId}`
      return undefined
    }

    const profiles = Effect.fn("Auth.profiles")(function* (providerID: string) {
      const data = yield* all()
      const active = data[providerID]
      const personal = data[profileKey(providerID, "personal")]
      const company = data[profileKey(providerID, "company")]
      return {
        personal: Boolean(personal),
        company: Boolean(company),
        personalIdentity: identity(personal),
        companyIdentity: identity(company),
        active:
          active && personal && JSON.stringify(active) === JSON.stringify(personal)
            ? ("personal" as const)
            : active && company && JSON.stringify(active) === JSON.stringify(company)
              ? ("company" as const)
              : undefined,
      }
    })

    const saveProfile = Effect.fn("Auth.saveProfile")(function* (
      providerID: string,
      profile: "personal" | "company",
    ) {
      const current = yield* get(providerID)
      if (current?.type !== "oauth")
        return yield* Effect.fail(new AuthError({ message: `Connect a ChatGPT OAuth login before saving ${profile}` }))
      const other = (yield* get(profileKey(providerID, profile === "personal" ? "company" : "personal")))
      if (other?.type === "oauth" && current.accountId && current.accountId === other.accountId)
        return yield* Effect.fail(new AuthError({ message: "This ChatGPT account is already saved in the other slot" }))
      yield* set(profileKey(providerID, profile), current)
    })

    const activateProfile = Effect.fn("Auth.activateProfile")(function* (
      providerID: string,
      profile: "personal" | "company",
    ) {
      const data = yield* all()
      const current = data[profileKey(providerID, profile)]
      if (!current) return yield* Effect.fail(new AuthError({ message: `${profile} ${providerID} profile is not connected` }))
      yield* fsys
        .writeJson(file, { ...data, [providerID]: current }, 0o600)
        .pipe(Effect.mapError(fail("Failed to activate auth profile")))
    })

    return Service.of({ get, all, set, remove, profiles, saveProfile, activateProfile })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

export * as Auth from "."
