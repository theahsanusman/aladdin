import { beforeEach, describe, expect, test } from "bun:test"
import { Unattended } from "@/automation/unattended"

beforeEach(() => Unattended.clear())

describe("unattended sessions", () => {
  test("tracks marked sessions", () => {
    expect(Unattended.isUnattended("ses_one")).toBe(false)
    Unattended.mark("ses_one")
    expect(Unattended.isUnattended("ses_one")).toBe(true)
    Unattended.unmark("ses_one")
    expect(Unattended.isUnattended("ses_one")).toBe(false)
  })

  test("unmarking an unknown session is a no-op", () => {
    expect(() => Unattended.unmark("ses_missing")).not.toThrow()
  })
})
