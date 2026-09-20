import { describe, expect, test } from "bun:test"
import { recordingMime } from "./voice"

describe("voice recording", () => {
  test("selects the first supported efficient recording format", () => {
    const recorder = { isTypeSupported: (mime: string) => mime === "audio/mp4" }
    expect(recordingMime(recorder as unknown as typeof MediaRecorder)).toBe("audio/mp4")
  })

  test("lets the browser choose when no preferred format is supported", () => {
    const recorder = { isTypeSupported: () => false }
    expect(recordingMime(recorder as unknown as typeof MediaRecorder)).toBeUndefined()
  })
})
