import { BARGE_IN_DUCK_GAIN, createBargeIn } from "./barge-in"
import { createListener } from "./listening"
import { speechChunks } from "./speech"
import { recordingMime } from "./voice"
import type { VoicePhase } from "./voice-call"

const ENDPOINT_POLL_MS = 150
const IDLE_TIMEOUT_MS = 1_500

export type VoiceAudio = { audio: string; mime: string }

// Owns the microphone, the speakers, and every timer between them for the lifetime of a voice
// message or a call. The call keeps one stream open and listens continuously: an utterance is
// settled by silence, not by a push-to-talk button, and it lands whether or not the assistant is
// mid-answer. Anything the assistant is doing when the user speaks is interrupted, which is what
// makes a call feel like talking to someone who is actually listening.
export function createVoiceCallEngine(input: {
  synthesize: (text: string, signal: AbortSignal) => Promise<VoiceAudio>
  transcribe: (blob: Blob | undefined) => Promise<string | undefined>
  onUtterance: (text: string) => Promise<void>
  onError: (error: unknown) => void
  onPhase: (phase: VoicePhase) => void
  onLevel: (level: number) => void
  silenceMs: () => number
  answer: () => { id: string; text: string } | undefined
  answerId: () => string | undefined
  working: () => boolean
  interrupt: () => Promise<void>
}) {
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let samples: Uint8Array<ArrayBuffer> | undefined
  let frame = 0
  let frameAt = 0
  let recorder: MediaRecorder | undefined
  let recorded: BlobPart[] = []
  let recordedMime: string | undefined
  let finishSegment: ((blob: Blob | undefined) => void) | undefined
  let playback: HTMLAudioElement | undefined
  let finishPlayback: (() => void) | undefined
  let synthesis: AbortController | undefined
  let epoch = 0
  let spoken: string | undefined
  let excluded: string | undefined
  let committing = false
  let queuedEndpoint = false
  let callLive = false
  let barge: ReturnType<typeof createBargeIn> | undefined
  let listener: ReturnType<typeof createListener> | undefined

  const setPhase = (phase: VoicePhase) => input.onPhase(phase)

  const releaseDevices = () => {
    cancelAnimationFrame(frame)
    frame = 0
    input.onLevel(0)
    void context?.close()
    context = undefined
    analyser = undefined
    samples = undefined
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
  }

  const ensureDevices = async () => {
    if (stream && context && analyser) return
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    context = new AudioContext()
    // A suspended context reports a flat zero level forever, which looks exactly like a dead button.
    if (context.state === "suspended") await context.resume()
    analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    samples = new Uint8Array(analyser.fftSize)
  }

  const level = () => {
    if (!analyser || !samples) return 0
    analyser.getByteTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2
    return Math.sqrt(sum / samples.length)
  }

  const beginSegment = () => {
    if (!stream) return
    recordedMime = recordingMime()
    recorded = []
    const segment = new MediaRecorder(stream, recordedMime ? { mimeType: recordedMime } : undefined)
    recorder = segment
    segment.ondataavailable = (event) => {
      if (event.data.size) recorded.push(event.data)
    }
    segment.onstop = () => {
      if (recorder === segment) recorder = undefined
      const resolve = finishSegment
      finishSegment = undefined
      resolve?.(new Blob(recorded, { type: recordedMime || "audio/webm" }))
    }
    segment.start()
  }

  const endSegment = () =>
    new Promise<Blob | undefined>((resolve) => {
      if (recorder?.state !== "recording") return resolve(undefined)
      finishSegment = resolve
      recorder.stop()
    })

  const interruptPlayback = () => {
    epoch += 1
    synthesis?.abort()
    synthesis = undefined
    barge?.disarm()
    const audio = playback
    playback = undefined
    if (audio) {
      audio.volume = 1
      audio.pause()
    }
    const finish = finishPlayback
    finishPlayback = undefined
    finish?.()
  }

  const waitForIdle = async () => {
    const deadline = Date.now() + IDLE_TIMEOUT_MS
    while (callLive && input.working() && Date.now() < deadline) await sleep(50)
  }

  // The user's words always win: stop whatever is being said, drop whatever the assistant is
  // working on, then hand the words over. The abandoned answer is remembered so it is never spoken
  // out loud after the interruption.
  const deliver = async (text: string) => {
    interruptPlayback()
    if (input.working()) {
      excluded = input.answerId()
      await input.interrupt()
      await waitForIdle()
    }
    await input.onUtterance(text)
  }

  const commitUtterance = async () => {
    committing = true
    const blob = await endSegment()
    if (callLive) {
      beginSegment()
      listener?.start(performance.now())
    }
    setPhase("transcribing")
    const text = await input.transcribe(blob).catch((error: unknown) => {
      if (callLive) input.onError(error)
      return undefined
    })
    if (callLive && text) await deliver(text)
    committing = false
    if (queuedEndpoint) {
      queuedEndpoint = false
      requestEndpoint()
    }
  }

  const requestEndpoint = () => {
    if (committing) {
      queuedEndpoint = true
      return
    }
    void commitUtterance()
  }

  const play = (audio: VoiceAudio) =>
    new Promise<void>((resolve) => {
      if (!callLive) return resolve()
      const element = new Audio(`data:${audio.mime};base64,${audio.audio}`)
      playback = element
      barge?.arm(performance.now())
      const done = () => {
        if (playback === element) {
          playback = undefined
          finishPlayback = undefined
        }
        barge?.disarm()
        resolve()
      }
      finishPlayback = done
      element.onended = done
      element.onerror = done
      void element.play().catch(done)
    })

  // Synthesis runs ahead of playback so the next sentence is already audio by the time the current
  // one finishes. Without the lookahead every sentence boundary would be an audible stall.
  const speak = async (text: string) => {
    setPhase("speaking")
    epoch += 1
    const at = epoch
    const controller = new AbortController()
    synthesis = controller
    const chunks = speechChunks(text)
    const requests = new Map<number, Promise<VoiceAudio>>()
    const load = (index: number) => {
      const existing = requests.get(index)
      if (existing) return existing
      const request = input.synthesize(chunks[index], controller.signal)
      requests.set(index, request)
      return request
    }
    try {
      for (let index = 0; index < chunks.length; index++) {
        if (!callLive || at !== epoch) return
        if (index + 1 < chunks.length) void load(index + 1).catch(() => {})
        const payload = await load(index).catch((error: unknown) => {
          if (controller.signal.aborted || at !== epoch) return undefined
          input.onError(error)
          return undefined
        })
        if (!callLive || at !== epoch) return
        if (!payload) return
        await play(payload)
      }
    } finally {
      if (synthesis === controller) synthesis = undefined
      barge?.disarm()
      if (playback) playback.volume = 1
    }
  }

  const nextAnswer = () => {
    const answer = input.answer()
    if (!answer) return
    if (answer.id === spoken || answer.id === excluded) return
    if (input.working()) return
    return answer
  }

  const speakNextAnswer = async () => {
    let waiting = false
    while (callLive) {
      const answer = nextAnswer()
      if (answer) {
        spoken = answer.id
        await speak(answer.text)
        return
      }
      const busy = input.working()
      if (busy !== waiting) {
        waiting = busy
        if (busy) setPhase("waiting")
        else if (!committing) setPhase("recording")
      }
      await sleep(ENDPOINT_POLL_MS)
    }
  }

  const monitor = () => {
    if (!analyser || !samples) return
    const now = performance.now()
    const elapsed = Math.max(1, now - frameAt)
    frameAt = now
    const rms = level()
    input.onLevel(Math.min(1, rms * 7))
    if (callLive && barge && listener) {
      const decision = barge.frame({ level: rms, now, durationMs: elapsed })
      if (playback) playback.volume = decision.ducked ? BARGE_IN_DUCK_GAIN : 1
      if (decision.interrupt) interruptPlayback()
      if (listener.frame({ level: rms, now, echoGate: !!playback, silenceMs: input.silenceMs() }).endpoint) {
        requestEndpoint()
      }
    }
    frame = requestAnimationFrame(monitor)
  }

  const startMonitor = () => {
    frameAt = performance.now()
    frame = requestAnimationFrame(monitor)
  }

  const startMessage = async () => {
    await ensureDevices()
    setPhase("recording")
    beginSegment()
    startMonitor()
  }

  const stopMessage = async () => {
    const blob = await endSegment()
    setPhase("transcribing")
    try {
      return await input.transcribe(blob)
    } finally {
      releaseDevices()
      setPhase("idle")
    }
  }

  const startCall = async () => {
    callLive = true
    await ensureDevices()
    if (!callLive) return releaseDevices()
    barge = createBargeIn()
    listener = createListener()
    listener.start(performance.now())
    beginSegment()
    setPhase("recording")
    startMonitor()
    while (callLive) await speakNextAnswer()
  }

  const stopCall = () => {
    callLive = false
    interruptPlayback()
    barge = undefined
    listener = undefined
    if (recorder?.state === "recording") recorder.stop()
    recorder = undefined
    finishSegment = undefined
    releaseDevices()
    setPhase("idle")
  }

  return { startMessage, stopMessage, startCall, stopCall }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
