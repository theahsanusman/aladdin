export type SpeechInputModel = "qwen3-asr-1.7b"
export type SpeechOutputModel = "qwen3-tts-1.7b"
export type ImageProvider = "openai" | "gemini" | "openrouter" | "draw-things"

export interface AladdinSettings {
  voice: {
    inputModel: SpeechInputModel
    outputModel: SpeechOutputModel
    outputVoice: string
    callMode: boolean
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
}

export const defaultAladdinSettings: AladdinSettings = {
  voice: {
    inputModel: "qwen3-asr-1.7b",
    outputModel: "qwen3-tts-1.7b",
    outputVoice: "Ryan",
    callMode: false,
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
}

export function normalizeModelList(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}
