import { shouldEndCallRecording } from "./voice-call"

export const LISTEN_SETTLE_MS = 150
export const LISTEN_FLOOR_MIN = 0.01
export const LISTEN_QUIET_THRESHOLD = 0.025
export const LISTEN_NOISE_FACTOR = 2.5
export const LISTEN_SPEECH_FRAMES = 3
export const LISTEN_FLOOR_RISE = 0.01

// A call keeps the microphone open for its whole life, so this has to endpoint many utterances in a
// row across two very different noise floors: the room while the assistant is quiet, and the
// assistant's own voice leaking back through the speakers while it speaks. While the assistant is
// audible the threshold is a fixed echo gate and the floor is never relearned - otherwise the
// assistant would teach the listener that talking is background noise.
//
// The floor follows the *quietest* recent level rather than the loudest, because the loudest frames
// are exactly the person talking. It drifts up slowly so a fan spinning up is still learned, and it
// freezes as soon as speech is detected so one long sentence cannot raise the bar above the speaker.
//
// A steady tone already above the speech threshold is genuinely ambiguous with a quiet talker, so it
// is allowed to end a turn. That is cheap: an empty transcription is ignored and the call keeps
// listening, so a false endpoint costs one request and nothing else.
export function createListener(input?: {
  settleMs?: number
  speechFrames?: number
  quietThreshold?: number
  noiseFactor?: number
  echoThreshold?: number
  floorRise?: number
}) {
  const settleMs = input?.settleMs ?? LISTEN_SETTLE_MS
  const speechFrames = input?.speechFrames ?? LISTEN_SPEECH_FRAMES
  const quietThreshold = input?.quietThreshold ?? LISTEN_QUIET_THRESHOLD
  const noiseFactor = input?.noiseFactor ?? LISTEN_NOISE_FACTOR
  const echoThreshold = input?.echoThreshold ?? LISTEN_QUIET_THRESHOLD
  const floorRise = input?.floorRise ?? LISTEN_FLOOR_RISE
  let noiseFloor = LISTEN_FLOOR_MIN
  let startedAt = 0
  let voiced = 0
  let heard = false
  let quietSince = 0
  return {
    get heard() {
      return heard
    },
    get noiseFloor() {
      return noiseFloor
    },
    start(now: number) {
      startedAt = now
      voiced = 0
      heard = false
      quietSince = 0
    },
    // `echoGate` means the assistant is currently audible through the speakers.
    frame(input: { level: number; now: number; echoGate: boolean; silenceMs: number }): { endpoint: boolean } {
      if (input.now - startedAt < settleMs) return { endpoint: false }
      if (!heard && !input.echoGate) {
        noiseFloor = input.level < noiseFloor ? input.level : noiseFloor + (input.level - noiseFloor) * floorRise
      }
      const speaking =
        input.level >= (input.echoGate ? echoThreshold : Math.max(quietThreshold, noiseFloor * noiseFactor))
      voiced = speaking ? voiced + 1 : 0
      if (voiced >= speechFrames) heard = true
      if (speaking) quietSince = 0
      else if (heard && !quietSince) quietSince = input.now
      const silentForMs = quietSince ? input.now - quietSince : 0
      if (!shouldEndCallRecording({ heardSpeech: heard, silentForMs, maxSilenceMs: input.silenceMs })) {
        return { endpoint: false }
      }
      voiced = 0
      heard = false
      quietSince = 0
      return { endpoint: true }
    },
  }
}
