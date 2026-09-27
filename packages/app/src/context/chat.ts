import { parseChatModel } from "@/context/aladdin-settings"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { useTabs } from "@/context/tabs"
import { errorMessage } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"

// The server owns the workspace path; this suffix only detects when a project
// already points at the chat workspace so chat sessions keep the chat model.
export function isChatDirectory(directory: string) {
  return /[/\\]Aladdin Chats$/.test(directory)
}

export function useChat() {
  const global = useGlobal()
  const tabs = useTabs()
  const settings = useSettings()
  const language = useLanguage()
  const models = useModels()
  const sdk = useServerSDK()

  // Prefer the configured chat model, but only when its provider is connected;
  // otherwise let the normal model resolution fall back gracefully.
  const model = () => {
    const parsed = parseChatModel(settings.aladdin.chat.model())
    if (!parsed) return
    const connected = models
      .list()
      .some((model) => model.provider.id === parsed.providerID && model.id === parsed.modelID)
    return connected ? parsed : undefined
  }

  const start = async (conn: ServerConnection.Any) => {
    try {
      const response = await sdk().request("/aladdin/chats/ensure", { method: "POST" })
      if (!response.ok) throw new Error(`chat workspace failed (${response.status})`)
      const { directory } = (await response.json()) as { directory: string }
      const ctx = global.ensureServerCtx(conn)
      void ctx.sdk.api.project
        .current({ location: { directory } })
        .then((project) => ctx.sync.child(directory, { bootstrap: false })[1]("project", project.id))
        .catch(() => undefined)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
      await tabs.newDraft({ server: ServerConnection.key(conn), directory }, undefined, model())
    } catch (cause) {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      })
    }
  }

  return { start, model }
}
