import { setTimeout } from "node:timers/promises"

type Child = { stop(): Promise<void> }

/** Owns one child, including startup and recovery, until normal app shutdown. */
export function createSidecarSupervisor(options: {
  spawn(onExit: () => void, signal: AbortSignal): Promise<Child>
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
  onFailure(error: unknown): void
}) {
  const controller = new AbortController()
  const delays = [250, 1000, 2500]
  const wait = options.wait ?? ((ms, signal) => setTimeout(ms, undefined, { signal }))
  let child: Child | undefined
  let stopped = false
  let generation = 0
  let attempts = 0
  let startedAt = 0
  let recovering = false
  let needsRecovery = false
  let pending = Promise.resolve()
  let starting: Promise<void> | undefined
  let stopping: Promise<void> | undefined

  async function spawn() {
    const current = ++generation
    let exited = false
    let published = false
    const next = await options.spawn(() => {
      exited = true
      if (stopped || current !== generation || !published) return
      child = undefined
      // A stable process starts a new retry window; a flapping process does not.
      if (Date.now() - startedAt >= 60_000) attempts = 0
      needsRecovery = true
      recover()
    }, controller.signal)
    if (stopped || exited) {
      await next.stop()
      if (stopped) return
      throw new Error("Sidecar exited during startup")
    }
    child = next
    startedAt = Date.now()
    published = true
  }

  function recover() {
    if (stopped || recovering) return
    recovering = true
    pending = (async () => {
      while (!stopped && needsRecovery) {
        needsRecovery = false
        if (attempts >= delays.length) {
          options.onFailure(new Error("Sidecar recovery exhausted its retry limit"))
          return
        }
        const delay = delays[attempts++]
        try {
          await wait(delay, controller.signal)
          if (stopped) return
          await spawn()
        } catch (error) {
          if (stopped) return
          options.onFailure(error)
          needsRecovery = true
        }
      }
    })().finally(() => {
      recovering = false
    })
  }

  return {
    start() {
      if (stopped) return Promise.reject(new Error("Sidecar supervisor is stopped"))
      if (starting) return starting
      starting = spawn()
      pending = starting
      return starting
    },
    settled: () => pending,
    stop() {
      if (stopping) return stopping
      stopped = true
      controller.abort()
      const current = child
      child = undefined
      stopping = Promise.all([current?.stop(), pending.catch(() => undefined)]).then(() => undefined)
      return stopping
    },
  }
}
