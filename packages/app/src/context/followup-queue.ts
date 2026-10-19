type Item = { id: string; sessionID: string }

/** Owns sends for every chat independently of any routed chat screen. */
export function createFollowupQueue<T extends Item>(input: {
  items: () => Record<string, T[] | undefined>
  eligible: (item: T, manual: boolean) => boolean
  busy: () => Promise<ReadonlySet<string>>
  send: (item: T, manual: boolean) => Promise<boolean>
  remove: (item: T) => void
  fail: (item: T, error: unknown) => void
  sending?: (sessionID: string, id: string, active: boolean) => void
}) {
  const running = new Map<string, Map<string, Promise<boolean>>>()
  let disposed = false
  let checking: Promise<ReadonlySet<string>> | undefined

  const send = (sessionID: string, id: string, manual = false): Promise<boolean> => {
    const current = running.get(sessionID)
    const existing = current?.get(id)
    if (existing) return existing
    if (current?.size && !manual) return current.values().next().value!
    const items = input.items()[sessionID] ?? []
    const item = items.find((entry) => entry.id === id)
    if (disposed || !item || (!manual && items[0] !== item) || !input.eligible(item, manual))
      return Promise.resolve(false)

    // Claim synchronously, before reactive notifications or asynchronous work can re-enter.
    const task = Promise.resolve()
      .then(async () => {
        if (disposed || !input.items()[sessionID]?.some((entry) => entry.id === id)) return false
        const ok = await input.send(item, manual)
        if (ok) input.remove(item)
        return ok
      })
      .catch((error: unknown) => {
        input.fail(item, error)
        return false
      })
      .finally(() => {
        const active = running.get(sessionID)
        active?.delete(id)
        if (active?.size === 0) running.delete(sessionID)
        input.sending?.(sessionID, id, false)
      })
    const active = current ?? new Map<string, Promise<boolean>>()
    active.set(id, task)
    running.set(sessionID, active)
    input.sending?.(sessionID, item.id, true)
    return task
  }

  return {
    send,
    async drain() {
      if (disposed) return
      const pending = () =>
        Object.values(input.items())
          .flatMap((items) => (items?.[0] ? [items[0]] : []))
          .filter((item) => !running.has(item.sessionID) && input.eligible(item, false))
      if (pending().length === 0) return
      const busy = await (checking ??= input.busy().finally(() => (checking = undefined)))
      if (disposed) return
      // Re-read after the status request: drafts may have been edited, deleted, or reordered.
      await Promise.all(
        pending()
          .filter((item) => !busy.has(item.sessionID))
          .map((item) => send(item.sessionID, item.id)),
      )
    },
    dispose() {
      disposed = true
    },
  }
}
