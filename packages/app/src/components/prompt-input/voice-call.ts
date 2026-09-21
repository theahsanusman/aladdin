export const CALL_SILENCE_MS = 3_000

export type VoicePhase = "idle" | "recording" | "transcribing" | "waiting" | "speaking"

export type VoiceControl = {
  action: "startMessage" | "stopMessage" | "startCall" | "stopCall" | "none"
  disabled: boolean
}

export function shouldEndCallRecording(input: { heardSpeech: boolean; silentForMs: number; maxSilenceMs?: number }) {
  const silenceMs = Math.min(5_000, Math.max(2_000, input.maxSilenceMs ?? CALL_SILENCE_MS))
  return input.heardSpeech && input.silentForMs >= silenceMs
}

// The microphone owns voice messages and the call control owns calls. Neither control may take over the
// other's recording, and an active call always keeps its stop control reachable.
export function voiceControls(input: {
  control: "message" | "call"
  phase: VoicePhase
  callActive: boolean
}): VoiceControl {
  if (input.control === "call") {
    if (input.callActive) return { action: "stopCall", disabled: false }
    if (input.phase !== "idle") return { action: "none", disabled: true }
    return { action: "startCall", disabled: false }
  }
  if (input.callActive) return { action: "none", disabled: true }
  if (input.phase === "recording") return { action: "stopMessage", disabled: false }
  if (input.phase !== "idle") return { action: "none", disabled: true }
  return { action: "startMessage", disabled: false }
}
