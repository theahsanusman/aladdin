export const BARGE_IN_ECHO_THRESHOLD = 0.05
export const BARGE_IN_GUARD_MS = 300
export const BARGE_IN_DUCK_MS = 200
export const BARGE_IN_CONFIRM_MS = 450
export const BARGE_IN_GAP_MS = 120
export const BARGE_IN_DUCK_GAIN = 0.35

export type BargeInDecision = { ducked: boolean; interrupt: boolean }

// Watching for a human talking over the assistant's own voice is an adversarial signal problem: the
// microphone hears the speakers too. Never cut the assistant off on a single loud frame. Duck first
// (reversible, and it drops the assistant's own contribution to the microphone), then only interrupt
// once speech has stayed continuous long enough to be a person rather than a cough, a door, or echo
// that survived acoustic cancellation. Every quiet gap resets the evidence so noise cannot accumulate.
export function createBargeIn(input?: {
  echoThreshold?: number
  guardMs?: number
  duckMs?: number
  confirmMs?: number
  gapMs?: number
}) {
  const echoThreshold = input?.echoThreshold ?? BARGE_IN_ECHO_THRESHOLD
  const guardMs = input?.guardMs ?? BARGE_IN_GUARD_MS
  const duckMs = input?.duckMs ?? BARGE_IN_DUCK_MS
  const confirmMs = input?.confirmMs ?? BARGE_IN_CONFIRM_MS
  const gapMs = input?.gapMs ?? BARGE_IN_GAP_MS
  let armed = false
  let armedAt = 0
  let voicedMs = 0
  let quietMs = 0
  let ducked = false
  const clear = () => {
    voicedMs = 0
    quietMs = 0
    ducked = false
  }
  return {
    get ducked() {
      return ducked
    },
    // Called when playback starts. The opening moments of the assistant's own voice are the worst
    // echo, so ignore them even though the assistant is audible.
    arm(now: number) {
      armed = true
      armedAt = now
      clear()
    },
    disarm() {
      armed = false
      clear()
    },
    frame(input: { level: number; now: number; durationMs: number }): BargeInDecision {
      if (!armed) return { ducked: false, interrupt: false }
      if (input.now - armedAt < guardMs) return { ducked: false, interrupt: false }
      if (input.level >= echoThreshold) {
        voicedMs += input.durationMs
        quietMs = 0
      } else {
        quietMs += input.durationMs
        if (quietMs >= gapMs) voicedMs = 0
      }
      if (voicedMs === 0) ducked = false
      else if (!ducked && voicedMs >= duckMs) ducked = true
      if (ducked && voicedMs >= confirmMs) {
        armed = false
        clear()
        return { ducked: false, interrupt: true }
      }
      return { ducked, interrupt: false }
    },
  }
}
