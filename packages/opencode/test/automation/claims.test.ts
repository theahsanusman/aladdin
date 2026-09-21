import { beforeEach, describe, expect, test } from "bun:test"
import { Claim } from "@/claim/registry"

beforeEach(() => Claim.clear())

describe("claim registry", () => {
  test("acquires unclaimed paths and allows same-session re-entry", () => {
    expect(Claim.acquire({ sessionID: "ses_one", paths: ["/a.ts", "/b.ts"] })).toBeUndefined()
    expect(Claim.acquire({ sessionID: "ses_one", paths: ["/a.ts"] })).toBeUndefined()
    expect(Claim.list().map((claim) => claim.path).sort()).toEqual(["/a.ts", "/b.ts"])
  })

  test("conflicts when another session holds a path", () => {
    expect(Claim.acquire({ sessionID: "ses_one", paths: ["/a.ts"] })).toBeUndefined()
    const conflict = Claim.acquire({ sessionID: "ses_two", paths: ["/b.ts", "/a.ts"] })
    expect(conflict?.path).toBe("/a.ts")
    expect(conflict?.owner).toBe("ses_one")
    // A conflicting batch must not claim any of its paths.
    expect(Claim.list().map((claim) => claim.path)).toEqual(["/a.ts"])
  })

  test("releases only the owner's claims", () => {
    Claim.acquire({ sessionID: "ses_one", paths: ["/a.ts"] })
    Claim.acquire({ sessionID: "ses_two", paths: ["/b.ts"] })
    Claim.releaseSession("ses_one")
    expect(Claim.list().map((claim) => claim.path)).toEqual(["/b.ts"])
  })

  test("records the tool call that acquired the claim", () => {
    Claim.acquire({ sessionID: "ses_one", paths: ["/a.ts"], callID: "call_1" })
    expect(Claim.list()).toEqual([{ path: "/a.ts", sessionID: "ses_one", callID: "call_1", time: expect.any(Number) }])
  })

  test("tracks conflict ownership for error messages", () => {
    Claim.acquire({ sessionID: "ses_owner", paths: ["/a.ts"] })
    const conflict = Claim.acquire({ sessionID: "ses_other", paths: ["/a.ts"] })
    expect(conflict).toMatchObject({
      _tag: "Automation.ClaimConflict",
      path: "/a.ts",
      owner: "ses_owner",
      sessionID: "ses_other",
    })
  })
})
