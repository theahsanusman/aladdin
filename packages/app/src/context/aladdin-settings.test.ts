import { describe, expect, test } from "bun:test"
import { defaultAladdinSettings, normalizeModelList, parseChatModel } from "./aladdin-settings"

describe("Aladdin settings", () => {
  test("defaults to local free voice and image providers", () => {
    expect(defaultAladdinSettings.voice.inputModel).toBe("qwen3-asr-1.7b")
    expect(defaultAladdinSettings.voice.outputModel).toBe("qwen3-tts-1.7b")
    expect(defaultAladdinSettings.image.provider).toBe("draw-things")
  })

  test("defaults chat sessions to the Command Code Xiaomi MiMo V2.6 flash model", () => {
    expect(defaultAladdinSettings.chat.model).toBe("commandcode/xiaomi/mimo-v2.6-flash")
  })

  test("parses the chat model preference into a prompt model", () => {
    expect(parseChatModel("commandcode/xiaomi/mimo-v2.6-flash")).toEqual({
      providerID: "commandcode",
      modelID: "xiaomi/mimo-v2.6-flash",
    })
    expect(parseChatModel("commandcode")).toBeUndefined()
    expect(parseChatModel("")).toBeUndefined()
    expect(parseChatModel(undefined)).toBeUndefined()
  })

  test("keeps discovered and manual Draw Things models unique and stable", () => {
    expect(normalizeModelList([" flux-2 ", "", "z-image", "flux-2"])).toEqual(["flux-2", "z-image"])
  })
})
