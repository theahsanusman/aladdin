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

  test("rejects non-array image lists instead of treating arbitrary failure fields as images", () => {
    expect(parseCloudImage("openai", { data: { 0: { b64_json: "private failure text" } } })).toBeUndefined()
    expect(parseCloudImage("openrouter", { data: { 0: { b64_json: "private failure text" } } })).toBeUndefined()
    expect(parseDrawThingsImage({ images: { 0: "private failure text" } })).toBeUndefined()
  })

  test("parses OpenRouter chat image data URLs without downloading remote image URLs", () => {
    expect(
      parseCloudImage("openrouter", {
        choices: [{ message: { images: [{ type: "image_url", image_url: { url: "data:image/webp;base64,QUJD" } }] } }],
      }),
    ).toEqual({ image: "QUJD", mime: "image/webp" })
    expect(
      parseCloudImage("openrouter", {
        choices: [
          { message: { images: [{ type: "image_url", image_url: { url: "https://example.com/private-image" } }] } },
        ],
      }),
    ).toBeUndefined()
  })
})
