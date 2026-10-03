import { expect, test } from "bun:test"
import { createComponent, createRoot, createSignal, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import { workerInteractionMemo } from "../src/utils/worker-interaction"

test("worker question polling preserves the current answer and focus until the interaction changes", () => {
  const host = document.createElement("div")
  document.body.append(host)
  const owned = createRoot((dispose) => {
    const [packet, setPacket] = createSignal<{ id: string; generation: number } | undefined>({ id: "first", generation: 1 })
    const pending = workerInteractionMemo(() => {
      const value = packet()
      return value ? { interaction: { ...value }, request: { id: value.id } } : undefined
    })
    const mounted: string[] = []
    const removed: string[] = []
    const stop = render(
      () =>
        createComponent(Show, {
          get when() { return pending() },
          keyed: true,
          children: (value: NonNullable<ReturnType<typeof pending>>) => {
            mounted.push(value.request.id)
            onCleanup(() => removed.push(value.request.id))
            const input = document.createElement("input")
            return input
          },
        }),
      host,
    )
    return { dispose, stop, setPacket, mounted, removed }
  })
  try {
    const input = host.querySelector("input")!
    input.value = "My answer"
    input.focus()
    owned.setPacket({ id: "first", generation: 1 })
    expect(host.querySelector("input")).toBe(input)
    expect(host.querySelector("input")?.value).toBe("My answer")
    expect(document.activeElement).toBe(input)
    expect(owned.mounted).toEqual(["first"])
    expect(owned.removed).toEqual([])

    owned.setPacket({ id: "second", generation: 2 })
    expect(host.querySelector("input")).not.toBe(input)
    expect(host.querySelector("input")?.value).toBe("")
    expect(owned.mounted).toEqual(["first", "second"])
    expect(owned.removed).toEqual(["first"])
    owned.setPacket(undefined)
    expect(host.querySelector("input")).toBeNull()
    expect(owned.removed).toEqual(["first", "second"])
  } finally {
    owned.stop()
    owned.dispose()
    host.remove()
  }
})
