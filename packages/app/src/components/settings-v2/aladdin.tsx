import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogConnectProvider, useProviderConnectController } from "../dialog-connect-provider"
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
  const dialog = useDialog()
  const connectController = useProviderConnectController()
  const [section, setSection] = createSignal<"accounts" | "voice" | "images" | "mobile">("accounts")
  const drawThingsModels = createMemo(() => settings.aladdin.image.drawThingsModels().join(", "))
  const [status, { refetch }] = createResource(async () => {
    const response = await server().request("/aladdin/status").catch(() => undefined)
    if (!response?.ok) return { speechInput: { available: false }, speechOutput: { available: false }, drawThingsModels: [] }
    return response.json() as Promise<{
      speechInput: { available: boolean }
      speechOutput: { available: boolean }
      drawThingsModels: string[]
    }>
  })
  type OpenAIProfiles = {
    personal: boolean
    company: boolean
    personalIdentity?: string
    companyIdentity?: string
    active?: "personal" | "company"
  }
  const [profiles, { refetch: refetchProfiles }] = createResource(async () => {
    const response = await server().request("/aladdin/auth/openai/profiles").catch(() => undefined)
    if (!response?.ok) return { personal: false, company: false } as OpenAIProfiles
    return response.json() as Promise<OpenAIProfiles>
  })
  const [voices] = createResource(async () => {
    const response = await server().request("/aladdin/voice/voices").catch(() => undefined)
    if (!response?.ok) return [] as string[]
    const result = (await response.json()) as { voices?: unknown }
    if (!Array.isArray(result.voices)) return [] as string[]
    return result.voices.filter((voice): voice is string => typeof voice === "string")
  })
  const [previewing, setPreviewing] = createSignal<string | undefined>()
  let preview: HTMLAudioElement | undefined
  const stopPreview = () => {
    preview?.pause()
    preview = undefined
    setPreviewing(undefined)
  }
  // Voices are only real when you hear them, so every preset can be auditioned in place. Only one
  // preview plays at a time and the same button stops it.
  const previewVoice = async (voice: string) => {
    const active = previewing()
    stopPreview()
    if (active === voice) return
    setPreviewing(voice)
    try {
      const response = await server().request("/aladdin/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: language.t("settings.aladdin.voice.preview.text"),
          model: settings.aladdin.voice.outputModel(),
          voice,
        }),
      })
      if (!response.ok) throw new Error(language.t("prompt.voice.error.output", { status: String(response.status) }))
      const result = (await response.json()) as { audio?: unknown; mime?: unknown }
      if (typeof result.audio !== "string" || typeof result.mime !== "string") {
        throw new Error(language.t("prompt.voice.error.outputInvalid"))
      }
      if (previewing() !== voice) return
      const audio = new Audio(`data:${result.mime};base64,${result.audio}`)
      preview = audio
      audio.onended = stopPreview
      audio.onerror = stopPreview
      await audio.play()
    } catch (error) {
      if (previewing() === voice) stopPreview()
      showToast({
        title: language.t("settings.aladdin.voice.preview.error.title"),
        description: error instanceof Error ? error.message : language.t("prompt.voice.error.description"),
        variant: "error",
      })
    }
  }
  onCleanup(stopPreview)

  const [mobile, { refetch: refetchMobile }] = createResource(async () => {
    const response = await server().request("/aladdin/mobile/status").catch(() => undefined)
    if (!response?.ok) return undefined
    return response.json() as Promise<{
      enabled: boolean
      available: boolean
      reason?: "password-required"
      url?: string
      connectUrl?: string
      host: string
      port?: number
      addresses: string[]
      certificateAuthority?: string
    }>
  })
  const [mobileBusy, setMobileBusy] = createSignal(false)
  const toggleMobile = async (value: boolean) => {
    setMobileBusy(true)
    try {
      const response = await server()
        .request(value ? "/aladdin/mobile/enable" : "/aladdin/mobile/disable", { method: "POST" })
        .catch(() => undefined)
      if (!response?.ok) {
        showToast({
          title: language.t("settings.aladdin.mobile.error.title"),
          description: (await response?.text().catch(() => "")) || language.t("common.requestFailed"),
          variant: "error",
        })
        await refetchMobile()
        return
      }
      settings.aladdin.mobile.setEnabled(value)
      await refetchMobile()
      showToast({
        title: language.t(value ? "settings.aladdin.mobile.enabled" : "settings.aladdin.mobile.disabled"),
      })
    } finally {
      setMobileBusy(false)
    }
  }
  const copyMobile = (value: string) =>
    void navigator.clipboard
      .writeText(value)
      .then(() => showToast({ title: language.t("settings.aladdin.mobile.copied") }))
      .catch(() => undefined)

  const accountCopy = {
    personal: {
      title: "settings.aladdin.accounts.personal",
      saved: "settings.aladdin.accounts.savedPersonal",
      switched: "settings.aladdin.accounts.switchedPersonal",
      missing: "settings.aladdin.accounts.error.notSavedPersonal",
    },
    company: {
      title: "settings.aladdin.accounts.company",
      saved: "settings.aladdin.accounts.savedCompany",
      switched: "settings.aladdin.accounts.switchedCompany",
      missing: "settings.aladdin.accounts.error.notSavedCompany",
    },
  } as const

  const updateProfile = async (action: "save" | "activate", profile: "personal" | "company") => {
    const response = await server().request(`/aladdin/auth/openai/profiles/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile }),
    }).catch(() => undefined)
    if (!response?.ok) {
      showToast({
        title: language.t("settings.aladdin.accounts.error.title"),
        description:
          action === "save"
            ? language.t("settings.aladdin.accounts.error.signIn")
            : language.t(accountCopy[profile].missing),
        variant: "error",
      })
      return
    }
    await refetchProfiles()
    showToast({
      title: language.t(action === "save" ? accountCopy[profile].saved : accountCopy[profile].switched),
    })
  }

  const connectProfile = (profile: "personal" | "company") => {
    connectController.select("openai")
    void dialog.show(() => (
      <DialogConnectProvider
        controller={connectController}
        onConnected={async (provider) => {
          if (provider !== "openai") return
          await updateProfile("save", profile)
        }}
      />
    ))
  }

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
        <div
          class="flex flex-wrap gap-2 pb-4"
          role="tablist"
          aria-label={language.t("settings.aladdin.tabs.aria")}
        >
          <For
            each={
              [
                ["accounts", "settings.aladdin.tab.accounts"],
                ["voice", "settings.aladdin.tab.voice"],
                ["images", "settings.aladdin.tab.images"],
                ["mobile", "settings.aladdin.tab.mobile"],
              ] as const
            }
          >
            {([value, label]) => (
              <ButtonV2 variant={section() === value ? "contrast" : "neutral"} role="tab" aria-selected={section() === value} onClick={() => setSection(value)}>
                {language.t(label)}
              </ButtonV2>
            )}
          </For>
        </div>
        <Show when={section() === "accounts"}>
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.aladdin.accounts.title")}</h3>
          <SettingsListV2>
            <For each={["personal", "company"] as const}>
              {(profile) => (
                <SettingsRowV2
                  title={language.t(accountCopy[profile].title)}
                  description={
                    profiles()?.[profile]
                      ? `${language.t(profiles()?.active === profile ? "settings.aladdin.accounts.connectedActive" : "settings.aladdin.accounts.connected")} · ${profiles()?.[profile === "personal" ? "personalIdentity" : "companyIdentity"] ?? language.t("settings.aladdin.accounts.identityUnknown")}`
                      : language.t("settings.aladdin.accounts.notSaved")
                  }
                >
                  <div class="flex flex-wrap justify-end gap-2">
                    <ButtonV2 variant="neutral" onClick={() => connectProfile(profile)}>
                      {language.t("settings.aladdin.accounts.connect")}
                    </ButtonV2>
                    <ButtonV2 variant="neutral" onClick={() => void updateProfile("save", profile)}>
                      {language.t("settings.aladdin.accounts.save")}
                    </ButtonV2>
                    <ButtonV2
                      variant="contrast"
                      disabled={!profiles()?.[profile] || profiles()?.active === profile}
                      onClick={() => void updateProfile("activate", profile)}
                    >
                      {language.t("settings.aladdin.accounts.use")}
                    </ButtonV2>
                  </div>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
          <p class="pt-2 text-12-regular text-text-weak">{language.t("settings.aladdin.accounts.help")}</p>
        </div>
        </Show>

        <Show when={section() === "voice"}>
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
            <Show when={!voices()?.length}>
              <SettingsRowV2
                title={language.t("settings.aladdin.voice.presets.title")}
                description={language.t("settings.aladdin.voice.presets.description")}
              >
                <span class="text-12-regular text-text-weak">
                  {voices.loading
                    ? language.t("settings.aladdin.status.checking")
                    : language.t("settings.aladdin.voice.presets.offline")}
                </span>
              </SettingsRowV2>
            </Show>
            <For each={voices() ?? []}>
              {(voice) => (
                <SettingsRowV2
                  title={voice}
                  description={
                    voice === settings.aladdin.voice.outputVoice()
                      ? language.t("settings.aladdin.voice.presets.selected")
                      : undefined
                  }
                >
                  <div class="flex items-center gap-2">
                    <ButtonV2
                      size="small"
                      variant="ghost"
                      icon={previewing() === voice ? "stop" : "play"}
                      onClick={() => void previewVoice(voice)}
                      aria-label={language.t(
                        previewing() === voice
                          ? "settings.aladdin.voice.presets.stop"
                          : "settings.aladdin.voice.presets.preview",
                        { voice },
                      )}
                      title={language.t(
                        previewing() === voice
                          ? "settings.aladdin.voice.presets.stop"
                          : "settings.aladdin.voice.presets.preview",
                        { voice },
                      )}
                    />
                    <ButtonV2
                      size="small"
                      variant={voice === settings.aladdin.voice.outputVoice() ? "neutral" : "outline"}
                      onClick={() => settings.aladdin.voice.setOutputVoice(voice)}
                    >
                      {language.t(
                        voice === settings.aladdin.voice.outputVoice()
                          ? "settings.aladdin.voice.presets.use"
                          : "settings.aladdin.voice.presets.choose",
                      )}
                    </ButtonV2>
                  </div>
                </SettingsRowV2>
              )}
            </For>
            <SettingsRowV2
              title={language.t("settings.aladdin.voice.custom.title")}
              description={language.t("settings.aladdin.voice.custom.description")}
            >
              <div class="w-full sm:w-[260px]">
                <TextInputV2
                  value={settings.aladdin.voice.outputVoice()}
                  onChange={(event) => settings.aladdin.voice.setOutputVoice(event.currentTarget.value)}
                  placeholder={language.t("settings.aladdin.voice.voice.placeholder")}
                  spellcheck={false}
                />
              </div>
            </SettingsRowV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.voice.callSilence.title")}
              description={language.t("settings.aladdin.voice.callSilence.description")}
            >
              <input
                type="range"
                min="2000"
                max="5000"
                step="1000"
                value={settings.aladdin.voice.callSilenceMs()}
                onInput={(event) => settings.aladdin.voice.setCallSilenceMs(Number(event.currentTarget.value))}
                aria-label={language.t("settings.aladdin.voice.callSilence.title")}
              />
              <span class="text-12-regular text-text-weak">
                {language.t("settings.aladdin.voice.callSilence.value", {
                  seconds: String(settings.aladdin.voice.callSilenceMs() / 1000),
                })}
              </span>
            </SettingsRowV2>
          </SettingsListV2>
        </div>
        </Show>

        <Show when={section() === "images"}>
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
                    "draw-things": language.t("settings.aladdin.image.provider.drawThings"),
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
                  placeholder={language.t("settings.aladdin.image.model.placeholder")}
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
                  placeholder={language.t("settings.aladdin.image.drawThingsModels.placeholder")}
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
        </Show>

        <Show when={section() === "mobile"}>
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.aladdin.section.mobileGoals")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.aladdin.mobile.title")}
              description={language.t(
                mobile()?.reason === "password-required"
                  ? "settings.aladdin.mobile.passwordRequired"
                  : "settings.aladdin.mobile.description",
              )}
            >
              <Switch
                checked={mobile()?.enabled ?? false}
                disabled={mobile.loading || mobileBusy() || mobile()?.reason === "password-required"}
                onChange={(value) => void toggleMobile(value)}
              />
            </SettingsRowV2>
            <Show when={mobile()?.connectUrl}>
              {(url) => (
                <SettingsRowV2
                  title={language.t("settings.aladdin.mobile.url.title")}
                  description={language.t("settings.aladdin.mobile.url.description")}
                >
                  <div class="flex items-center gap-2">
                    <code class="max-w-[240px] truncate text-12-regular text-text-base">
                      {mobile()?.url ?? url()}
                    </code>
                    <ButtonV2 size="small" variant="neutral" onClick={() => copyMobile(url())}>
                      {language.t("settings.aladdin.mobile.copy")}
                    </ButtonV2>
                  </div>
                </SettingsRowV2>
              )}
            </Show>
            <Show when={mobile()?.certificateAuthority}>
              {(authority) => (
                <SettingsRowV2
                  title={language.t("settings.aladdin.mobile.certificate.title")}
                  description={language.t("settings.aladdin.mobile.certificate.description")}
                >
                  <div class="flex items-center gap-2">
                    <code class="max-w-[240px] truncate text-12-regular text-text-weak">{authority()}</code>
                    <ButtonV2 size="small" variant="ghost" onClick={() => copyMobile(authority())}>
                      {language.t("settings.aladdin.mobile.copy")}
                    </ButtonV2>
                  </div>
                </SettingsRowV2>
              )}
            </Show>
            <Show when={mobile()?.certificateAuthority}>
              <SettingsRowV2
                title={language.t("settings.aladdin.mobile.trust.title")}
                description={language.t("settings.aladdin.mobile.trust.description")}
              >
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.aladdin.mobile.trust.airdrop")}
                </span>
              </SettingsRowV2>
            </Show>
            <Show when={mobile()?.enabled}>
              <SettingsRowV2
                title={language.t("settings.aladdin.mobile.addresses.title")}
                description={language.t("settings.aladdin.mobile.addresses.description")}
              >
                <span class="text-12-regular text-text-weak">
                  {(mobile()?.addresses ?? []).join(", ") || language.t("settings.aladdin.mobile.addresses.none")}
                </span>
              </SettingsRowV2>
            </Show>
          </SettingsListV2>
        </div>
        </Show>
      </div>
    </>
  )
}
