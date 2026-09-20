import { describe, expect, test } from "bun:test"
import { parseCloudImage, parseDrawThingsImage } from "../../src/aladdin/image"

describe("Aladdin image adapters", () => {
  test("parses OpenAI and OpenRouter image responses", () => {
    expect(parseCloudImage("openai", { data: [{ b64_json: "abc" }] })).toEqual({
      image: "abc",
      mime: "image/png",
    })
    expect(parseCloudImage("openrouter", { data: [{ b64_json: "xyz", media_type: "image/svg+xml" }] })).toEqual({
      image: "xyz",
      mime: "image/svg+xml",
    })
  })

  test("parses Gemini inline image output and ignores text", () => {
    expect(
      parseCloudImage("gemini", {
        candidates: [
          { content: { parts: [{ text: "done" }, { inlineData: { data: "png", mimeType: "image/png" } }] } },
        ],
      }),
    ).toEqual({ image: "png", mime: "image/png" })
  })

  test("parses Draw Things plain and data-url images", () => {
    expect(parseDrawThingsImage({ images: ["raw"] })).toEqual({ image: "raw", mime: "image/png" })
    expect(parseDrawThingsImage({ images: ["data:image/webp;base64,encoded"] })).toEqual({
      image: "encoded",
      mime: "image/webp",
    })
  })
})
