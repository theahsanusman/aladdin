import { describe, expect, test } from "bun:test"
import { createListener } from "./listening"

const FRAME = 20
const SILENCE_MS = 3_000

type Listener = ReturnType<typeof createListener>

function feed(listener: Listener, input: { level: number; frames: number; from: number; echoGate?: boolean; silenceMs?: number }) {
  let now = input.from
  let endpoint = false
  for (let index = 0; index < input.frames; index++) {
    now += FRAME
    endpoint = listener.frame({ level: input.level, now, echoGate: input.echoGate ?? false, silenceMs: input.silenceMs ?? SILENCE_MS }).endpoint
  }
  return { endpoint, now }
}

// Feeds quiet frames until the turn ends and reports how much silence it took.
function waitForEnd(listener: Listener, input: { from: number; silenceMs?: number; maxFrames?: number }) {
  const silenceMs = input.silenceMs ?? SILENCE_MS
  let now = input.from
  let quiet = 0
  for (let index = 0; index < (input.maxFrames ?? 2_000); index++) {
    now += FRAME
    if (!listener.frame({ level: 0.001, now, echoGate: false, silenceMs }).endpoint) {
      quiet += 1
      continue
    }
    return { ended: true, silenceMs: quiet * FRAME, now }
  }
  return { ended: false, silenceMs: quiet * FRAME, now }
}

describe("call listener endpoint", () => {
  test("never ends a turn that contains no speech, however quiet it gets", () => {
    const listener = createListener()
    listener.start(0)
    expect(feed(listener, { level: 0.001, frames: 400, from: 0 }).endpoint).toBe(false)
    expect(waitForEnd(listener, { from: 8_000 }).ended).toBe(false)
  })

  test("ends the turn once speech is followed by the configured silence", () => {
    const listener = createListener()
    listener.start(0)
    const spoken = feed(listener, { level: 0.2, frames: 20, from: 0 })
    expect(spoken.endpoint).toBe(false)
    const end = waitForEnd(listener, { from: spoken.now })
    expect(end.ended).toBe(true)
    expect(end.silenceMs).toBe(SILENCE_MS)
  })

  test("starts a fresh turn after an endpoint", () => {
    const listener = createListener()
    listener.start(0)
    const spoken = feed(listener, { level: 0.2, frames: 20, from: 0 })
    const end = waitForEnd(listener, { from: spoken.now })
    expect(end.ended).toBe(true)
    expect(waitForEnd(listener, { from: end.now }).ended).toBe(false)
  })

  test("waits through a natural pause inside one sentence", () => {
    const listener = createListener()
    listener.start(0)
    const spoken = feed(listener, { level: 0.2, frames: 20, from: 0 })
    const pause = feed(listener, { level: 0.001, frames: 40, from: spoken.now })
    expect(pause.endpoint).toBe(false)
    const resumed = feed(listener, { level: 0.2, frames: 20, from: pause.now })
    expect(resumed.endpoint).toBe(false)
    const end = waitForEnd(listener, { from: resumed.now })
    expect(end.ended).toBe(true)
    expect(end.silenceMs).toBe(SILENCE_MS)
  })

  test("hears someone who starts talking immediately", () => {
    const listener = createListener()
    listener.start(0)
    const spoken = feed(listener, { level: 0.25, frames: 30, from: 0 })
    expect(listener.heard).toBe(true)
    expect(waitForEnd(listener, { from: spoken.now }).ended).toBe(true)
  })

  test("a speaker trailing off still ends the turn instead of hanging", () => {
    const listener = createListener()
    listener.start(0)
    feed(listener, { level: 0.2, frames: 40, from: 0 })
    const spoken = feed(listener, { level: 0.05, frames: 40, from: 800 })
    expect(spoken.endpoint).toBe(false)
    expect(waitForEnd(listener, { from: spoken.now }).ended).toBe(true)
  })

  test("ignores its own speech leaking through the speakers", () => {
    const listener = createListener()
    listener.start(0)
    expect(feed(listener, { level: 0.06, frames: 500, from: 0, echoGate: true }).endpoint).toBe(false)
  })

  test("does not learn its own speech as background noise", () => {
    const listener = createListener()
    listener.start(0)
    const own = feed(listener, { level: 0.5, frames: 30, from: 0, echoGate: true })
    const spoken = feed(listener, { level: 0.12, frames: 20, from: own.now })
    expect(spoken.endpoint).toBe(false)
    expect(waitForEnd(listener, { from: spoken.now }).ended).toBe(true)
  })

  test("ignores room tone below the speech threshold", () => {
    const listener = createListener()
    listener.start(0)
    expect(feed(listener, { level: 0.02, frames: 400, from: 0 }).endpoint).toBe(false)
    expect(listener.noiseFloor).toBeCloseTo(0.02, 3)
    expect(waitForEnd(listener, { from: 8_000 }).ended).toBe(false)
  })

  test("still hears a person over a room that was learned", () => {
    const listener = createListener()
    listener.start(0)
    feed(listener, { level: 0.05, frames: 150, from: 0 })
    const spoken = feed(listener, { level: 0.3, frames: 20, from: 3_000 })
    expect(waitForEnd(listener, { from: spoken.now }).ended).toBe(true)
  })

  test("honours a longer configured silence window", () => {
    const listener = createListener()
    listener.start(0)
    const spoken = feed(listener, { level: 0.2, frames: 20, from: 0 })
    const end = waitForEnd(listener, { from: spoken.now, silenceMs: 5_000 })
    expect(end.ended).toBe(true)
    expect(end.silenceMs).toBe(5_000)
  })
})
