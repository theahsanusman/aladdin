import { describe, expect, test } from "bun:test"
import { createFollowupQueue } from "./followup-queue"

type Item = { id: string; sessionID: string }

function fixture(send: (item: Item, manual: boolean) => Promise<boolean> = async () => true) {
  const items: Record<string, Item[]> = {}
  const busy = new Set<string>()
  const paused = new Set<string>()
  const failed = new Set<string>()
  const started: string[] = []
  const sending = new Map<string, Set<string>>()
  const queue = createFollowupQueue({
    items: () => items,
    eligible: (item, manual) => manual || (!paused.has(item.sessionID) && !failed.has(item.sessionID)),
    busy: async () => new Set(busy),
    send: async (item, manual) => {
      started.push(item.id)
      return send(item, manual)
    },
    remove: (item) => {
      items[item.sessionID] = items[item.sessionID].filter((entry) => entry.id !== item.id)
    },
    fail: (item) => void failed.add(item.sessionID),
    sending: (sessionID, id, active) => {
      const ids = sending.get(sessionID) ?? new Set<string>()
      if (active) ids.add(id)
      if (!active) ids.delete(id)
      if (ids.size) sending.set(sessionID, ids)
      if (!ids.size) sending.delete(sessionID)
    },
  })
  const add = (sessionID: string, count = 3) => {
    items[sessionID] = Array.from({ length: count }, (_, index) => ({ id: `${sessionID}-${index}`, sessionID }))
  }
  return { queue, items, busy, paused, failed, started, sending, add }
}

function deferred() {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((done) => (resolve = done))
  return { promise, resolve }
}

describe("background follow-up queue", () => {
  test("drains five chats in FIFO order without an active-chat input", async () => {
    const f = fixture()
    const sessions = ["one", "two", "three", "four", "five"]
    sessions.forEach((id) => f.add(id))
    await f.queue.drain()
    await f.queue.drain()
    await f.queue.drain()
    expect(f.started).toHaveLength(15)
    sessions.forEach((id) => {
      expect(f.started.filter((entry) => entry.startsWith(`${id}-`))).toEqual([`${id}-0`, `${id}-1`, `${id}-2`])
      expect(f.items[id]).toEqual([])
    })
  })

  test("one busy chat does not hold up the other four", async () => {
    const f = fixture()
    ;["one", "two", "three", "four", "five"].forEach((id) => f.add(id, 1))
    f.busy.add("one")
    await f.queue.drain()
    expect(f.started).toEqual(["two-0", "three-0", "four-0", "five-0"])
    f.busy.clear()
    await f.queue.drain()
    expect(f.started.at(-1)).toBe("one-0")
  })

  test("repeated drains and send-now share one in-flight send per chat", async () => {
    const pending = deferred()
    const entered = Promise.withResolvers<void>()
    const f = fixture(async () => {
      entered.resolve()
      return pending.promise
    })
    f.add("one")
    const first = f.queue.drain()
    await entered.promise
    const second = f.queue.drain()
    const manual = f.queue.send("one", "one-0", true)
    expect(f.sending.get("one")).toEqual(new Set(["one-0"]))
    expect(f.started).toEqual(["one-0"])
    pending.resolve(true)
    await Promise.all([first, second, manual])
    expect(f.started).toEqual(["one-0"])
    expect(f.items.one.map((item) => item.id)).toEqual(["one-1", "one-2"])
    expect(f.sending.size).toBe(0)
  })

  test("a slow chat does not block dispatch into another chat", async () => {
    const pending = deferred()
    const entered = Promise.withResolvers<void>()
    const other = Promise.withResolvers<void>()
    const f = fixture(async (item) => {
      if (item.sessionID !== "one") {
        other.resolve()
        return true
      }
      entered.resolve()
      return pending.promise
    })
    f.add("one", 1)
    const first = f.queue.drain()
    await entered.promise
    f.add("two", 1)
    const second = f.queue.drain()
    await other.promise
    expect(f.sending.has("one")).toBe(true)
    pending.resolve(true)
    await Promise.all([first, second])
    expect(f.started).toEqual(["one-0", "two-0"])
  })

  test("a failed chat retains its message and does not stop other chats", async () => {
    const f = fixture(async (item) => {
      if (item.sessionID === "one") throw new Error("connection lost")
      return true
    })
    ;["one", "two", "three"].forEach((id) => f.add(id, 1))
    await f.queue.drain()
    await f.queue.drain()
    expect(f.items.one).toHaveLength(1)
    expect(f.failed.has("one")).toBe(true)
    expect(f.items.two).toEqual([])
    expect(f.items.three).toEqual([])
    expect(f.started.filter((id) => id === "one-0")).toHaveLength(1)
  })

  test("paused messages wait for explicit send-now", async () => {
    const f = fixture()
    f.add("one", 1)
    f.paused.add("one")
    await f.queue.drain()
    expect(f.started).toEqual([])
    await f.queue.send("one", "one-0", true)
    expect(f.started).toEqual(["one-0"])
  })

  test("send-now steers a different queued item without duplicating the running turn", async () => {
    const pending = deferred()
    const entered = Promise.withResolvers<void>()
    const f = fixture(async (item) => {
      if (item.id !== "one-0") return true
      entered.resolve()
      return pending.promise
    })
    f.add("one")
    const automatic = f.queue.drain()
    await entered.promise
    await Promise.all([f.queue.send("one", "one-2", true), f.queue.send("one", "one-2", true)])
    expect(f.started).toEqual(["one-0", "one-2"])
    expect(f.sending.get("one")).toEqual(new Set(["one-0"]))
    await f.queue.drain()
    expect(f.started).toEqual(["one-0", "one-2"])
    pending.resolve(true)
    await automatic
    await f.queue.drain()
    expect(f.started).toEqual(["one-0", "one-2", "one-1"])
  })

  test("rechecks deletion and reordering after a status request", async () => {
    const status = Promise.withResolvers<ReadonlySet<string>>()
    const items: Record<string, Item[]> = { one: [{ id: "old", sessionID: "one" }] }
    const started: string[] = []
    const queue = createFollowupQueue({
      items: () => items,
      eligible: () => true,
      busy: () => status.promise,
      send: async (item) => (started.push(item.id), true),
      remove: () => void (items.one = []),
      fail: () => {},
    })
    const run = queue.drain()
    items.one = [{ id: "replacement", sessionID: "one" }]
    status.resolve(new Set())
    await run
    expect(started).toEqual(["replacement"])
  })

  test("an unaccepted send remains queued", async () => {
    const f = fixture(async () => false)
    f.add("one", 1)
    await f.queue.drain()
    expect(f.items.one).toHaveLength(1)
  })

  test("disposing during a status request prevents new sends", async () => {
    const status = Promise.withResolvers<ReadonlySet<string>>()
    const started: string[] = []
    const queue = createFollowupQueue({
      items: () => ({ one: [{ id: "one-0", sessionID: "one" }] }),
      eligible: () => true,
      busy: () => status.promise,
      send: async (item) => (started.push(item.id), true),
      remove: () => {},
      fail: () => {},
    })
    const run = queue.drain()
    queue.dispose()
    status.resolve(new Set())
    await run
    expect(started).toEqual([])
  })
})
