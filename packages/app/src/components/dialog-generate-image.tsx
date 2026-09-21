import { createMemo, createSignal, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { generatedImageFile } from "./prompt-input/image-generation"

const sizes = ["1024x1024", "1536x1024", "1024x1536"]

export function DialogGenerateImage(props: { onGenerated: (file: File) => unknown | Promise<unknown> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const settings = useSettings()
  const server = useServerSDK()
  const [prompt, setPrompt] = createSignal("")
  const [size, setSize] = createSignal(sizes[0]!)
  const [generating, setGenerating] = createSignal(false)
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const provider = settings.aladdin.image.provider
  const model = createMemo(() =>
    provider() === "draw-things" ? settings.aladdin.image.drawThingsModel() : settings.aladdin.image.model(),
  )

  const generate = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!prompt().trim() || !model().trim() || generating()) return
    setGenerating(true)
    try {
      const response = await server().request("/aladdin/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: provider(), model: model(), prompt: prompt().trim(), size: size() }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = await response.json().catch(() => undefined)
        const message = error && typeof error === "object" && "message" in error ? error.message : undefined
        throw new Error(
          typeof message === "string"
            ? message
            : language.t("prompt.image.error.failed", { status: String(response.status) }),
        )
      }
      const result = (await response.json()) as { image?: unknown; mime?: unknown }
      if (typeof result.image !== "string" || typeof result.mime !== "string") {
        throw new Error(language.t("prompt.image.error.invalid"))
      }
      const attached = await props.onGenerated(generatedImageFile({ image: result.image, mime: result.mime }))
      if (attached === false) throw new Error(language.t("prompt.image.error.attach"))
      dialog.close()
    } catch (error) {
      showToast({
        title: language.t("prompt.image.error.title"),
        description: error instanceof Error ? error.message : language.t("prompt.image.error.description"),
        variant: "error",
      })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog fit>
      <form onSubmit={generate} class="contents">
        <DialogHeader>
          <DialogTitle>{language.t("prompt.image.dialog.title")}</DialogTitle>
        </DialogHeader>
        <DividerV2 />
        <DialogBody class="flex w-full min-w-[min(440px,calc(100vw-32px))] flex-col gap-4 px-4 py-4">
          <Field>
            <Field.Label>{language.t("prompt.image.dialog.prompt")}</Field.Label>
            <TextareaV2
              autofocus
              rows={5}
              value={prompt()}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              placeholder={language.t("prompt.image.dialog.placeholder")}
            />
          </Field>
          <Field>
            <Field.Label>{language.t("prompt.image.dialog.provider")}</Field.Label>
            <TextInputV2 value={provider()} disabled />
          </Field>
          <Field>
            <Field.Label>{language.t("prompt.image.dialog.model")}</Field.Label>
            <TextInputV2 value={model()} disabled />
          </Field>
          <Field>
            <Field.Label>{language.t("prompt.image.dialog.size")}</Field.Label>
            <SelectV2 options={sizes} current={size()} label={(value) => value} onSelect={(value) => value && setSize(value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 type="button" variant="ghost" onClick={dialog.close}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant={generating() ? "loading" : "contrast"} disabled={!prompt().trim() || !model().trim() || generating()}>
            {generating() ? language.t("prompt.image.dialog.generating") : language.t("prompt.image.dialog.generate")}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
