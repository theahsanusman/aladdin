import { describe, expect, test } from "bun:test"
import { generatedImageFile } from "./image-generation"

describe("generatedImageFile", () => {
  test("converts base64 output into an attachable image file", async () => {
    const file = generatedImageFile({ image: btoa("aladdin"), mime: "image/webp" })

    expect(file.name).toBe("aladdin-image.webp")
    expect(file.type).toBe("image/webp")
    expect(await file.text()).toBe("aladdin")
  })
})
