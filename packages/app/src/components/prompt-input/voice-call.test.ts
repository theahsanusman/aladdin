import { describe, expect, test } from "bun:test"
import { shouldEndCallRecording, voiceControls, type VoicePhase } from "./voice-call"

describe("call recording silence detection", () => {
  test("waits for speech before treating silence as the end", () => {
    expect(shouldEndCallRecording({ heardSpeech: false, silentForMs: 5_000 })).toBe(false)
  })

  test("ends after speech followed by sustained silence", () => {
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 3_000 })).toBe(true)
  })

  test("keeps listening during a normal pause", () => {
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 2_999 })).toBe(false)
  })

  test("supports a five-second configured silence window", () => {
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 5_000, maxSilenceMs: 5_000 })).toBe(true)
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 4_999, maxSilenceMs: 5_000 })).toBe(false)
  })

  test("clamps configured silence to the supported two-to-five-second range", () => {
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 1_999, maxSilenceMs: 1_000 })).toBe(false)
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 2_000, maxSilenceMs: 1_000 })).toBe(true)
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 5_000, maxSilenceMs: 6_000 })).toBe(true)
    expect(shouldEndCallRecording({ heardSpeech: true, silentForMs: 5_001, maxSilenceMs: 6_000 })).toBe(true)
  })
})

describe("voice and call controls", () => {
  test("the microphone records a voice message and stops the same recording", () => {
    expect(voiceControls({ control: "message", phase: "idle", callActive: false })).toEqual({
      action: "startMessage",
      disabled: false,
    })
    expect(voiceControls({ control: "message", phase: "recording", callActive: false })).toEqual({
      action: "stopMessage",
      disabled: false,
    })
  })

  test("the microphone never starts or stops a call", () => {
    const phases: VoicePhase[] = ["idle", "recording", "transcribing", "waiting", "speaking"]
    const actions = phases.flatMap((phase) =>
      [false, true].map((callActive) => voiceControls({ control: "message", phase, callActive }).action),
    )
    expect(new Set(actions)).toEqual(new Set(["startMessage", "stopMessage", "none"]))
  })

  test("the microphone is unavailable while a call owns the device", () => {
    expect(voiceControls({ control: "message", phase: "idle", callActive: true })).toEqual({
      action: "none",
      disabled: true,
    })
    expect(voiceControls({ control: "message", phase: "recording", callActive: true }).disabled).toBe(true)
  })

  test("the call control starts and ends the call", () => {
    expect(voiceControls({ control: "call", phase: "idle", callActive: false })).toEqual({
      action: "startCall",
      disabled: false,
    })
    expect(voiceControls({ control: "call", phase: "recording", callActive: true })).toEqual({
      action: "stopCall",
      disabled: false,
    })
  })

  test("an active call keeps its stop control during transcription and playback", () => {
    for (const phase of ["recording", "transcribing", "waiting", "speaking"] as VoicePhase[]) {
      expect(voiceControls({ control: "call", phase, callActive: true })).toEqual({ action: "stopCall", disabled: false })
    }
  })

  test("the call control never sends a voice message and is blocked while one is recorded", () => {
    const phases: VoicePhase[] = ["idle", "recording", "transcribing", "waiting", "speaking"]
    const actions = phases.flatMap((phase) =>
      [false, true].map((callActive) => voiceControls({ control: "call", phase, callActive }).action),
    )
    expect(new Set(actions)).toEqual(new Set(["startCall", "stopCall", "none"]))
    expect(voiceControls({ control: "call", phase: "recording", callActive: false }).disabled).toBe(true)
    expect(voiceControls({ control: "call", phase: "transcribing", callActive: false }).disabled).toBe(true)
  })
})
