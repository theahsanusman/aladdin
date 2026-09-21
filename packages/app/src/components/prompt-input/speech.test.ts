import { describe, expect, test } from "bun:test"
import { speechChunks, SPEECH_CHUNK_MAX, SPEECH_FIRST_MAX } from "./speech"

describe("speech chunking", () => {
  test("returns nothing for text with no speech in it", () => {
    expect(speechChunks("")).toEqual([])
    expect(speechChunks("   \n\t  ")).toEqual([])
  })

  test("speaks a short reply as a single chunk", () => {
    expect(speechChunks("Done.")).toEqual(["Done."])
  })

  test("starts with the first sentence so audio begins without waiting for the rest", () => {
    expect(speechChunks("Hello there. How are you? I am fine.")).toEqual(["Hello there.", "How are you? I am fine."])
  })

  test("keeps the first chunk short and packs the rest", () => {
    const chunks = speechChunks(
      "Sure. I looked at the parser, found the off by one, and fixed it. The tests pass now. Anything else?",
    )
    expect(chunks[0]).toBe("Sure.")
    expect(chunks.length).toBe(2)
    expect(chunks[1]).toBe("I looked at the parser, found the off by one, and fixed it. The tests pass now. Anything else?")
  })

  test("never hands the synthesizer a chunk past its limit", () => {
    const text = `${Array.from({ length: 40 }, (_, index) => `Sentence number ${index} keeps this reply going.`).join(" ")}`
    const chunks = speechChunks(text)
    expect(chunks.length).toBeGreaterThan(4)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SPEECH_CHUNK_MAX)
  })

  test("splits a long run-on sentence at word boundaries", () => {
    const text = Array.from({ length: 200 }, () => "word").join(" ")
    const chunks = speechChunks(text)
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(SPEECH_CHUNK_MAX)
      expect(chunk.startsWith("word")).toBe(true)
      expect(chunk.endsWith("word")).toBe(true)
    }
  })

  test("chops a single token that is longer than a whole chunk", () => {
    const chunks = speechChunks("a".repeat(SPEECH_CHUNK_MAX * 2 + 5))
    expect(chunks.map((chunk) => chunk.length)).toEqual([SPEECH_CHUNK_MAX, SPEECH_CHUNK_MAX, 5])
  })

  test("preserves the words of a normal reply", () => {
    const text = "First sentence. Second sentence, with a comma. Third one ends here. Fourth and final."
    expect(speechChunks(text).join(" ")).toBe(text)
  })

  test("treats newlines as ordinary whitespace", () => {
    expect(speechChunks("Line one.\n\nLine two.")).toEqual(["Line one.", "Line two."])
  })
})
