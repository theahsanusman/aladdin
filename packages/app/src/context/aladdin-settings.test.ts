import { describe, expect, test } from "bun:test"
import { defaultAladdinSettings, normalizeModelList } from "./aladdin-settings"

describe("Aladdin settings", () => {
  test("defaults to local free voice and image providers", () => {
    expect(defaultAladdinSettings.voice.inputModel).toBe("qwen3-asr-1.7b")
    expect(defaultAladdinSettings.voice.outputModel).toBe("qwen3-tts-1.7b")
    expect(defaultAladdinSettings.image.provider).toBe("draw-things")
  })

  test("keeps discovered and manual Draw Things models unique and stable", () => {
    expect(normalizeModelList([" flux-2 ", "", "z-image", "flux-2"])).toEqual(["flux-2", "z-image"])
  })
})
