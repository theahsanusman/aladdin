export type SpeechInputModel = "qwen3-asr-1.7b"
export type SpeechOutputModel = "qwen3-tts-1.7b"
export type ImageProvider = "openai" | "gemini" | "openrouter" | "draw-things"

export interface AladdinSettings {
  voice: {
    inputModel: SpeechInputModel
    outputModel: SpeechOutputModel
    outputVoice: string
    callSilenceMs: number
  }
  image: {
    provider: ImageProvider
    model: string
    drawThingsModel: string
    drawThingsModels: string[]
  }
  mobile: {
    enabled: boolean
  }
  chat: {
    /** "providerID/modelID" preference applied to new folder-less chats. */
    model: string
  }
}

export const defaultAladdinSettings: AladdinSettings = {
  voice: {
    inputModel: "qwen3-asr-1.7b",
    outputModel: "qwen3-tts-1.7b",
    outputVoice: "Ryan",
    callSilenceMs: 3_000,
  },
  image: {
    provider: "draw-things",
    model: "",
    drawThingsModel: "",
    drawThingsModels: [],
  },
  mobile: {
    enabled: false,
  },
  chat: {
    model: "commandcode/xiaomi/mimo-v2.6-flash",
  },
}

export function parseChatModel(value: string | undefined) {
  const [providerID, ...rest] = (value ?? "").split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

export function normalizeModelList(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}
