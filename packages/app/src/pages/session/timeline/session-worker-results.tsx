import { For, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { createWorkerClient } from "@/utils/worker-client"
import { workerNotice } from "@/utils/worker-notice"
import { workerEvidence, workerResultText } from "@/utils/worker-evidence"
import { showToast } from "@/utils/toast"

type Board = Awaited<ReturnType<ReturnType<typeof createWorkerClient>["board"]>>
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"])
// Only finished jobs can be deleted; interrupted work still needs recovery.
const deletable = new Set(["completed", "failed", "cancelled"])

export function SessionWorkerResults() {
  const params = useParams()
  const server = useServerSDK()
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()
  const [store, set] = createStore({
    items: [] as (Board["data"][number] & { id: string })[],
    unavailable: false,
    busy: "",
  })
  const lifecycle = { epoch: 0, disposed: false }
  const results = createMemo(() => store.items.filter((item) => terminal.has(item.task.status)))
  const refresh = async () => {
    const id = params.id
    if (!id || sync().session.get(id)?.parentID) return
    const owner = server()
    const epoch = ++lifecycle.epoch
    try {
      const board = await createWorkerClient(owner.server.http, platform.fetch).board({ sessionID: id })
      if (lifecycle.disposed || epoch !== lifecycle.epoch || id !== params.id || owner !== server()) return
      set("items", reconcile(board.data.map((item) => ({ ...item, id: item.task.id }))))
      set("unavailable", false)
    } catch {
      if (!lifecycle.disposed && epoch === lifecycle.epoch) set("unavailable", true)
    }
  }
  const remove = async (item: Board["data"][number]) => {
    if (store.busy || !params.id) return
    set("busy", item.task.id)
    try {
      await createWorkerClient(server().server.http, platform.fetch).dismiss({
        sessionID: params.id,
        taskID: item.task.id,
      })
      set("items", (items) => items.filter((current) => current.task.id !== item.task.id))
      await refresh()
    } catch (error) {
      showToast({
        title: language.t("session.workers.failedRequest"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    } finally {
      set("busy", "")
    }
  }
  createEffect(
    on(
      () => [params.id, server()],
      () => {
        lifecycle.epoch++
        set({ items: [], unavailable: false, busy: "" })
        void refresh()
      },
    ),
  )
  createEffect(() => {
    const off = server().event.listen((event) => {
      if (workerNotice(event.details, params.id)) void refresh()
    })
    onCleanup(off)
  })
  onMount(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const timer = window.setInterval(visible, 10_000)
    window.addEventListener("focus", visible)
    document.addEventListener("visibilitychange", visible)
    onCleanup(() => {
      window.clearInterval(timer)
      window.removeEventListener("focus", visible)
      document.removeEventListener("visibilitychange", visible)
    })
  })
  onCleanup(() => {
    lifecycle.disposed = true
    lifecycle.epoch++
  })
  return (
    <Show when={results().length > 0}>
      <section
        data-component="session-worker-results"
        class="mx-auto w-full max-w-3xl px-4 pb-16 flex flex-col gap-4"
        aria-label={language.t("session.workers.results")}
      >
        <Show when={store.unavailable}>
          <p role="status" class="text-12 text-text-weak">
            {language.t("session.workers.reconnecting")}
          </p>
        </Show>
        <For each={results()}>
          {(item) => (
            <article data-worker-result-id={item.task.id} class="rounded-md border border-border-weak-base p-4 min-w-0">
              <div class="flex flex-wrap gap-2 items-center mb-3">
                <bdi dir="auto" class="font-medium min-w-0 max-w-full break-words">
                  {language.t("session.workers.forTask", { title: item.task.brief.title })}
                </bdi>
                <span class="text-12 text-text-weak">{language.t(`session.workers.state.${item.task.status}`)}</span>
                <Show when={deletable.has(item.task.status)}>
                  <span class="ms-auto">
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={!!store.busy}
                      aria-label={language.t("session.workers.deleteTask", { title: item.task.brief.title })}
                      onClick={() => void remove(item)}
                    >
                      {language.t("session.workers.delete")}
                    </Button>
                  </span>
                </Show>
              </div>
              <Markdown
                text={
                  item.task.status === "cancelled"
                    ? language.t("session.workers.cancelledMessage")
                    : workerResultText(item.evidence ?? "") || language.t(`session.workers.state.${item.task.status}`)
                }
              />
              <Show when={item.evidence && !workerEvidence(item.evidence)}>
                <details class="mt-3 text-12 text-text-weak">
                  <summary>{language.t("session.workers.technicalDetails")}</summary>
                  <pre dir="auto" class="whitespace-pre-wrap break-words max-h-52 overflow-auto">
                    {item.evidence}
                  </pre>
                </details>
              </Show>
              <Show when={workerEvidence(item.evidence ?? "")} keyed>
                {(result) => (
                  <details class="mt-3 text-12 text-text-weak">
                    <summary>{language.t("session.workers.checksResult")}</summary>
                    <For each={result.checks}>
                      {(check) => (
                        <div class="mt-2">
                          <p>{check.check}</p>
                          <Markdown text={check.evidence} />
                        </div>
                      )}
                    </For>
                  </details>
                )}
              </Show>
            </article>
          )}
        </For>
      </section>
    </Show>
  )
}
