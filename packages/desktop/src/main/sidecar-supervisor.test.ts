import { expect, test } from "bun:test"
import { createSidecarSupervisor } from "./sidecar-supervisor"

test("unexpected exits recover serially while normal shutdown never starts another child", async () => {
  const exits: (() => void)[] = []
  const stopped: number[] = []
  const delays: number[] = []
  const supervisor = createSidecarSupervisor({
    spawn: async (exit) => {
      const id = exits.push(exit)
      return {
        stop: async () => {
          stopped.push(id)
          exit()
        },
      }
    },
    wait: async (delay) => {
      delays.push(delay)
    },
    onFailure: () => {},
  })
  await supervisor.start()
  exits[0]()
  await supervisor.settled()
  expect(exits).toHaveLength(2)
  expect(delays).toEqual([250])
  // A late exit from the old process cannot restart the replacement.
  exits[0]()
  await supervisor.stop()
  expect(stopped).toEqual([2])
  expect(exits).toHaveLength(2)
})

test("repeated startup failures stop at bounded retries", async () => {
  const exits: (() => void)[] = []
  const errors: unknown[] = []
  const supervisor = createSidecarSupervisor({
    spawn: async (exit) => {
      exits.push(exit)
      if (exits.length > 1) throw new Error("Unavailable")
      return { stop: async () => {} }
    },
    wait: async () => {},
    onFailure: (error) => {
      errors.push(error)
    },
  })
  await supervisor.start()
  exits[0]()
  await supervisor.settled()
  expect(exits).toHaveLength(4)
  expect(errors.length).toBeGreaterThan(0)
  await supervisor.stop()
})

test("shutdown aborts recovery before it can spawn a replacement", async () => {
  const exits: (() => void)[] = []
  const supervisor = createSidecarSupervisor({
    spawn: async (exit) => {
      exits.push(exit)
      return { stop: async () => {} }
    },
    wait: (_delay, signal) =>
      new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
    onFailure: () => {},
  })
  await supervisor.start()
  exits[0]()
  await supervisor.stop()
  expect(exits).toHaveLength(1)
})

test("shutdown joins an in-flight startup and disposes the child it returns", async () => {
  const stopped: number[] = []
  const supervisor = createSidecarSupervisor({
    spawn: (_exit, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () =>
            resolve({
              stop: async () => {
                stopped.push(1)
              },
            }),
          { once: true },
        )
      }),
    onFailure: () => {},
  })
  const startup = supervisor.start()
  await supervisor.stop()
  await startup
  expect(stopped).toEqual([1])
  await expect(supervisor.start()).rejects.toThrow("stopped")
})
