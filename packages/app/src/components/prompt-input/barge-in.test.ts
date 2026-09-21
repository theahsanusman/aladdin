import { describe, expect, test } from "bun:test"
import { createBargeIn } from "./barge-in"

const FRAME = 20

function feed(
  barge: ReturnType<typeof createBargeIn>,
  input: { level: number; frames: number; from: number },
) {
  let now = input.from
  let decision = { ducked: false, interrupt: false }
  for (let index = 0; index < input.frames; index++) {
    now += FRAME
    decision = barge.frame({ level: input.level, now, durationMs: FRAME })
    if (decision.interrupt) break
  }
  return { decision, now }
}

describe("barge-in", () => {
  test("does nothing while the assistant is not speaking", () => {
    const barge = createBargeIn()
    expect(feed(barge, { level: 0.9, frames: 40, from: 0 }).decision).toEqual({ ducked: false, interrupt: false })
  })

  test("ignores loud audio during the opening echo of its own speech", () => {
    const barge = createBargeIn({ guardMs: 300 })
    barge.arm(0)
    expect(feed(barge, { level: 0.9, frames: 14, from: 0 }).decision).toEqual({ ducked: false, interrupt: false })
  })

  test("ducks before it interrupts so the reaction stays reversible", () => {
    const barge = createBargeIn()
    barge.arm(0)
    const duck = feed(barge, { level: 0.2, frames: 12, from: 300 })
    expect(duck.decision).toEqual({ ducked: true, interrupt: false })
  })

  test("interrupts once speech has stayed continuous long enough to be a person", () => {
    const barge = createBargeIn()
    barge.arm(0)
    const result = feed(barge, { level: 0.2, frames: 26, from: 300 })
    expect(result.decision).toEqual({ ducked: false, interrupt: true })
  })

  test("never interrupts on levels below the echo gate", () => {
    const barge = createBargeIn()
    barge.arm(0)
    expect(feed(barge, { level: 0.03, frames: 200, from: 300 }).decision).toEqual({ ducked: false, interrupt: false })
  })

  test("stops interrupting after the first interruption until re-armed", () => {
    const barge = createBargeIn()
    barge.arm(0)
    expect(feed(barge, { level: 0.2, frames: 26, from: 300 }).decision.interrupt).toBe(true)
    expect(feed(barge, { level: 0.2, frames: 60, from: 1000 }).decision).toEqual({ ducked: false, interrupt: false })
  })

  test("a burst of noise ducks and then recovers instead of ending the turn", () => {
    const barge = createBargeIn()
    barge.arm(0)
    const burst = feed(barge, { level: 0.2, frames: 12, from: 300 })
    expect(burst.decision.ducked).toBe(true)
    const recovered = feed(barge, { level: 0.01, frames: 10, from: burst.now })
    expect(recovered.decision).toEqual({ ducked: false, interrupt: false })
  })

  test("separated bursts never accumulate into an interruption", () => {
    const barge = createBargeIn()
    barge.arm(0)
    let now = 300
    for (let index = 0; index < 8; index++) {
      now = feed(barge, { level: 0.2, frames: 10, from: now }).now
      const gap = feed(barge, { level: 0.01, frames: 8, from: now })
      now = gap.now
      expect(gap.decision.interrupt).toBe(false)
    }
  })

  test("an interruption after re-arming is reported again", () => {
    const barge = createBargeIn()
    barge.arm(0)
    expect(feed(barge, { level: 0.2, frames: 26, from: 300 }).decision.interrupt).toBe(true)
    barge.arm(2000)
    expect(feed(barge, { level: 0.2, frames: 26, from: 2300 }).decision.interrupt).toBe(true)
  })
})
