import { createMemo, createResource } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import type { ImageProvider, SpeechInputModel, SpeechOutputModel } from "@/context/aladdin-settings"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

const inputModels: SpeechInputModel[] = ["qwen3-asr-1.7b"]
const outputModels: SpeechOutputModel[] = ["qwen3-tts-1.7b"]
const imageProviders: ImageProvider[] = ["draw-things", "openai", "gemini", "openrouter"]

export const SettingsAladdin = (props: { onOpenProviders: () => void }) => {
  const language = useLanguage()
  const settings = useSettings()
  const server = useServerSDK()
  const drawThingsModels = createMemo(() => settings.aladdin.image.drawThingsModels().join(", "))
  const [status, { refetch }] = createResource(async () => {
    const response = await server().request("/aladdin/status")
    if (!response.ok) throw new Error(`Aladdin status failed (${response.status})`)
    return response.json() as Promise<{
      speechInput: { available: boolean }
      speechOutput: { available: boolean }
      drawThingsModels: string[]
    }>
  })

  const refreshModels = async () => {
    try {
      const next = await refetch()
      if (!next) return
      settings.aladdin.image.setDrawThingsModels([
        ...settings.aladdin.image.drawThingsModels(),
        ...next.drawThingsModels,
      ])
    } catch (error) {
      showToast({
        title: language.t("settings.aladdin.status.error"),
        description: error instanceof Error ? error.message : language.t("settings.aladdin.status.error"),
        variant: "error",
      })
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.aladdin.title")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.aladdin.section.voiceInput")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.status.title")}
              description={language.t("settings.aladdin.status.description")}
            >
              <span class="text-12-regular text-text-base">
                {status.loading
                  ? language.t("settings.aladdin.status.checking")
                  : status()?.speechInput.available
                    ? language.t("settings.aladdin.status.ready")
                    : language.t("settings.aladdin.status.offline")}
              </span>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.voice.inputModel.title")}
              description={language.t("settings.aladdin.voice.inputModel.description")}
            >
              <SelectV2
                appearance="inline"
                options={inputModels}
                current={settings.aladdin.voice.inputModel()}
                label={() => "Qwen3-ASR 1.7B"}
                onSelect={(model) => model && settings.aladdin.voice.setInputModel(model)}
              />
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.aladdin.section.voiceOutput")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.status.title")}
              description={language.t("settings.aladdin.status.description")}
            >
              <span class="text-12-regular text-text-base">
                {status.loading
                  ? language.t("settings.aladdin.status.checking")
                  : status()?.speechOutput.available
                    ? language.t("settings.aladdin.status.ready")
                    : language.t("settings.aladdin.status.offline")}
              </span>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.voice.outputModel.title")}
              description={language.t("settings.aladdin.voice.outputModel.description")}
            >
              <SelectV2
                appearance="inline"
                options={outputModels}
                current={settings.aladdin.voice.outputModel()}
                label={() => "Qwen3-TTS 1.7B"}
                onSelect={(model) => model && settings.aladdin.voice.setOutputModel(model)}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.voice.voice.title")}
              description={language.t("settings.aladdin.voice.voice.description")}
            >
              <div class="w-full sm:w-[260px]">
                <TextInputV2
                  value={settings.aladdin.voice.outputVoice()}
                  onChange={(event) => settings.aladdin.voice.setOutputVoice(event.currentTarget.value)}
                  placeholder="Ryan, designed voice, or imported voice"
                  spellcheck={false}
                />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.voice.callMode.title")}
              description={language.t("settings.aladdin.voice.callMode.description")}
            >
              <Switch
                checked={settings.aladdin.voice.callMode()}
                onChange={(value) => settings.aladdin.voice.setCallMode(value)}
              />
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.aladdin.section.images")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.image.provider.title")}
              description={language.t("settings.aladdin.image.provider.description")}
            >
              <SelectV2
                appearance="inline"
                options={imageProviders}
                current={settings.aladdin.image.provider()}
                label={(provider) =>
                  ({
                    "draw-things": "Draw Things (local)",
                    openai: "OpenAI",
                    gemini: "Google Gemini",
                    openrouter: "OpenRouter",
                  })[provider]
                }
                onSelect={(provider) => provider && settings.aladdin.image.setProvider(provider)}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.image.model.title")}
              description={language.t("settings.aladdin.image.model.description")}
            >
              <div class="w-full sm:w-[260px]">
                <TextInputV2
                  value={settings.aladdin.image.model()}
                  onChange={(event) => settings.aladdin.image.setModel(event.currentTarget.value)}
                  placeholder="Provider model ID"
                  spellcheck={false}
                />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.image.keys.title")}
              description={language.t("settings.aladdin.image.keys.description")}
            >
              <ButtonV2 variant="neutral" onClick={props.onOpenProviders}>
                {language.t("settings.aladdin.image.keys.action")}
              </ButtonV2>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.image.drawThingsModels.title")}
              description={language.t("settings.aladdin.image.drawThingsModels.description")}
            >
              <div class="w-full sm:w-[260px]">
                <TextInputV2
                  value={drawThingsModels()}
                  onChange={(event) => settings.aladdin.image.setDrawThingsModels(event.currentTarget.value.split(","))}
                  placeholder="Detected or manual model names"
                  spellcheck={false}
                />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.image.drawThingsModel.title")}
              description={language.t("settings.aladdin.image.drawThingsModel.description")}
            >
              <SelectV2
                appearance="inline"
                options={settings.aladdin.image.drawThingsModels()}
                current={settings.aladdin.image.drawThingsModel()}
                label={(model) => model}
                onSelect={(model) => model && settings.aladdin.image.setDrawThingsModel(model)}
              />
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.image.discovery.title")}
              description={language.t("settings.aladdin.image.discovery.description")}
            >
              <ButtonV2 variant="neutral" disabled={status.loading} onClick={() => void refreshModels()}>
                {language.t("settings.aladdin.image.discovery.action")}
              </ButtonV2>
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.aladdin.section.mobileGoals")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.mobile.title")}
              description={language.t("settings.aladdin.mobile.description")}
            >
              <Switch
                checked={settings.aladdin.mobile.enabled()}
                onChange={(value) => settings.aladdin.mobile.setEnabled(value)}
              />
            </SettingsRowV2>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
