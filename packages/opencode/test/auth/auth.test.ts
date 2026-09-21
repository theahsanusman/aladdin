import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

describe("Auth", () => {
  it.instance("does not save an API key as a ChatGPT account", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openai", { type: "api", key: "test-api-key" })
      const result = yield* Effect.result(auth.saveProfile("openai", "personal"))
      expect(result._tag).toBe("Failure")
    }),
  )

  it.instance("rejects saving the same ChatGPT account in both slots", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openai", { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "same-id" })
      yield* auth.saveProfile("openai", "personal")
      const result = yield* Effect.result(auth.saveProfile("openai", "company"))
      expect(result._tag).toBe("Failure")
      expect((yield* auth.profiles("openai")).company).toBe(false)
    }),
  )

  it.instance("shows a saved email before falling back to account ID", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openai", {
        type: "oauth",
        refresh: "r",
        access: "a",
        expires: 1,
        accountId: "account-id",
        email: "person@example.com",
      })
      yield* auth.saveProfile("openai", "personal")
      expect((yield* auth.profiles("openai")).personalIdentity).toBe("Email: person@example.com")
    }),
  )

  it.instance("keeps named OpenAI profiles isolated and activates the selected profile", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("openai", { type: "oauth", refresh: "personal-r", access: "personal-a", expires: 1, accountId: "personal-id" })
      yield* auth.saveProfile("openai", "personal")
      yield* auth.set("openai", { type: "oauth", refresh: "company-r", access: "company-a", expires: 2, accountId: "company-id" })
      yield* auth.saveProfile("openai", "company")

      expect(yield* auth.profiles("openai")).toEqual({
        personal: true,
        company: true,
        personalIdentity: "Account ID: personal-id",
        companyIdentity: "Account ID: company-id",
        active: "company",
      })
      yield* auth.activateProfile("openai", "personal")
      const active = yield* auth.get("openai")
      expect(active?.type).toBe("oauth")
      if (active?.type === "oauth") expect(active.access).toBe("personal-a")
      expect((yield* auth.profiles("openai")).active).toBe("personal")
      yield* auth.set("openai", { type: "oauth", refresh: "personal-r2", access: "personal-a2", expires: 3, accountId: "personal-id" })
      expect((yield* auth.profiles("openai")).active).toBe("personal")
      yield* auth.activateProfile("openai", "company")
      const company = yield* auth.get("openai")
      if (company?.type === "oauth") expect(company.access).toBe("company-a")
      yield* auth.activateProfile("openai", "personal")
      const refreshed = yield* auth.get("openai")
      if (refreshed?.type === "oauth") expect(refreshed.access).toBe("personal-a2")
    }),
  )

  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeDefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "old",
      })
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("example.com"))
      expect(keys).toEqual(["https://example.com"])
      const entry = data["https://example.com"]!
      expect(entry.type).toBe("wellknown")
      if (entry.type === "wellknown") expect(entry.token).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      yield* auth.remove("https://example.com/")
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeUndefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["anthropic"]).toBeDefined()
      yield* auth.remove("anthropic")
      const after = yield* auth.all()
      expect(after["anthropic"]).toBeUndefined()
    }),
  )
})
