import { describe, expect, test } from "bun:test"
import { followupDragIndex, moveFollowup } from "./followup-order"

describe("moveFollowup", () => {
  test("moves an item down", () => {
    expect(moveFollowup(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
  })

  test("moves an item up", () => {
    expect(moveFollowup(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
  })

  test("moves an item to the next slot", () => {
    expect(moveFollowup(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"])
  })

  test("keeps the order for identical indexes and out of range targets", () => {
    expect(moveFollowup(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"])
    expect(moveFollowup(["a", "b", "c"], 1, 3)).toEqual(["a", "b", "c"])
    expect(moveFollowup(["a", "b", "c"], -1, 1)).toEqual(["a", "b", "c"])
  })

  test("does not mutate the input", () => {
    const items = ["a", "b", "c"]
    moveFollowup(items, 0, 2)
    expect(items).toEqual(["a", "b", "c"])
  })
})

describe("followupDragIndex", () => {
  test("resolves the target index from item ids", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }]
    expect(followupDragIndex(items, "one", "three")).toBe(2)
    expect(followupDragIndex(items, "three", "one")).toBe(0)
  })

  test("ignores drops on the dragged item and unknown ids", () => {
    const items = [{ id: "one" }, { id: "two" }]
    expect(followupDragIndex(items, "one", "one")).toBeUndefined()
    expect(followupDragIndex(items, "missing", "two")).toBeUndefined()
    expect(followupDragIndex(items, "one", "missing")).toBeUndefined()
  })
})
