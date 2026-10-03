import { For, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { useServerSDK } from "@/context/server-sdk"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { workerEvidence } from "@/utils/worker-evidence"
import { workerNotice } from "@/utils/worker-notice"
import { workerAgent, workerAgents } from "@/utils/worker-agents"
import { createWorkerClient } from "@/utils/worker-client"
import { workerInteractionMemo } from "@/utils/worker-interaction"
import { showToast } from "@/utils/toast"
import { Schema } from "effect"
import { Question } from "@opencode-ai/schema/question"
import { SessionQuestionDock } from "./session-question-dock"
import { SessionPermissionDock } from "./session-permission-dock"
import { PermissionV1 } from "@opencode-ai/schema/permission-v1"
import { Permission } from "@opencode-ai/schema/permission"

const labels = {
  queued: "session.workers.state.queued",
  starting: "session.workers.state.starting",
  running: "session.workers.state.running",
  waiting_for_user: "session.workers.state.waiting_for_user",
  verifying: "session.workers.state.verifying",
  cancelling: "session.workers.state.cancelling",
  interrupted: "session.workers.state.interrupted",
  completed: "session.workers.state.completed",
  failed: "session.workers.state.failed",
  cancelled: "session.workers.state.cancelled",
} as const
const assigned = ["starting", "running", "waiting_for_user", "verifying", "cancelling", "interrupted"]
type Board = Awaited<ReturnType<ReturnType<typeof createWorkerClient>["board"]>>
type Interactions = Awaited<ReturnType<ReturnType<typeof createWorkerClient>["interactions"]>>
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

export function SessionWorkerDock() {
  const params = useParams()
  const server = useServerSDK()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const platform = usePlatform()
  const language = useLanguage()
  const api = createMemo(() => createWorkerClient(server().server.http, platform.fetch))
  const root = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))
  const [store, set] = createStore({
    items: [] as (Board["data"][number] & { id: string })[],
    counts: {} as Record<string, number>,
    paused: false,
    open: false,
    form: false,
    busy: "",
    supported: true,
    title: "",
    objective: "",
    checks: "",
    paths: "",
    agent: "",
    mode: "native" as "native" | "report" | "research" | "coding",
    calls: 20,
    minutes: 60,
    dispatchKey: "",
    interactions: [] as Interactions,
    recovery: {} as Record<string, { stopped?: boolean; reviewed?: boolean }>,
  })
  const lifecycle = { epoch: 0, disposed: false }
  onCleanup(() => {
    lifecycle.disposed = true
    lifecycle.epoch++
  })
  const agents = createMemo(() => workerAgents(sync().data.agent))
  const selectedAgent = createMemo(() => workerAgent(agents(), store.agent, local.agent.current()?.name))
  const count = createMemo(() => assigned.reduce((total, status) => total + (store.counts[status] ?? 0), 0))
  const refresh = async () => {
    const id = params.id
    if (!id || root()?.parentID) return
    const owner = server()
    const epoch = ++lifecycle.epoch
    try {
      const [board, interactions] = await Promise.all([
        api().board({ sessionID: id }),
        api().interactions({ sessionID: id }),
      ])
      if (lifecycle.disposed || epoch !== lifecycle.epoch || id !== params.id || owner !== server()) return
      set("items", reconcile(board.data.map((detail) => ({ ...detail, id: detail.task.id }))))
      set("counts", reconcile(board.counts))
      set("paused", board.team.paused)
      set("supported", true)
      set("interactions", reconcile(interactions))
    } catch {
      if (lifecycle.disposed || epoch !== lifecycle.epoch) return
      set("supported", false)
    }
  }
  createEffect(
    on(
      () => [params.id, server()],
      () => {
        lifecycle.epoch++
        set({
          items: [],
          interactions: [],
          counts: {},
          paused: false,
          open: false,
          busy: "",
          form: false,
          dispatchKey: "",
          recovery: {},
        })
        void refresh()
      },
    ),
  )
  createEffect(() => {
    const current = server()
    const off = current.event.listen((event) => {
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
  const action = async (key: string, run: () => Promise<unknown>) => {
    if (store.busy) return
    const id = params.id
    set("busy", key)
    try {
      await run()
      if (id === params.id) await refresh()
    } catch (error) {
      showToast({
        title: language.t("session.workers.failedRequest"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    } finally {
      if (id === params.id) set("busy", "")
    }
  }
  const dispatch = async (event: SubmitEvent) => {
    event.preventDefault()
    const id = params.id
    const model = local.model.current()
    const agent = selectedAgent()
    if (!id || !model || !agent) {
      showToast({ title: language.t("session.workers.noModel") })
      return
    }
    const engine = await sdk().protocol
    const variant = local.model.variant.current()
    const dispatchKey = store.dispatchKey || crypto.randomUUID()
    set("dispatchKey", dispatchKey)
    await action("dispatch", async () => {
      await api().dispatch({
        sessionID: id,
        dispatchKey,
        brief: {
          title: store.title,
          objective: store.objective,
          scope: [sdk().directory],
          output: "A concise report with artifact references and verification evidence",
          checks: lines(store.checks),
          constraints: ["Do not deploy, publish, commit, or push; preserve user edits"],
          execution: {
            engine,
            mode: store.mode,
            agent,
            model: { id: model.id, providerID: model.provider.id, ...(variant ? { variant } : {}) },
            maxCalls: store.calls,
            wallClockMs: store.minutes * 60_000,
            ...(store.mode === "coding" ? { paths: lines(store.paths) } : {}),
          },
        },
      })
      if (id === params.id) set({ form: false, title: "", objective: "", checks: "", paths: "", dispatchKey: "" })
    })
  }
  const field = "w-full rounded border border-border-weak-base bg-background-base px-2 py-1 text-12"
  const question = workerInteractionMemo(() => {
    const interaction = store.interactions.find((item) => item.kind === "question" && item.state === "pending")
    if (!interaction) return
    const task = store.items.find((item) => item.id === interaction.taskID)?.task
    if (
      !task ||
      task.generation !== interaction.generation ||
      task.status === "interrupted" ||
      task.status === "cancelling"
    )
      return
    const request = Schema.decodeUnknownOption(Question.Request)(interaction.payload)
    if (request._tag !== "Some") return
    return { interaction, request: request.value, title: task.brief.title }
  })
  const permission = workerInteractionMemo(() => {
    const interaction = store.interactions.find((item) => item.kind === "permission" && item.state === "pending")
    if (!interaction) return
    const task = store.items.find((item) => item.id === interaction.taskID)?.task
    if (
      !task ||
      task.generation !== interaction.generation ||
      task.status === "interrupted" ||
      task.status === "cancelling"
    )
      return
    if (interaction.format === "v1") {
      const request = Schema.decodeUnknownOption(PermissionV1.Request)(interaction.payload)
      if (request._tag !== "Some") return
      return { interaction, request: request.value, title: task.brief.title }
    }
    const parsed = Schema.decodeUnknownOption(Permission.Request)(interaction.payload)
    if (parsed._tag !== "Some") return
    const request = parsed.value
    return {
      interaction,
      title: task.brief.title,
      request: {
        id: request.id,
        sessionID: request.sessionID,
        permission: request.action,
        patterns: request.resources,
        always: request.save ?? [],
        metadata: request.metadata ?? {},
        ...(request.source?.type === "tool"
          ? { tool: { messageID: request.source.messageID, callID: request.source.callID } }
          : {}),
      },
    }
  })
  return (
    <Show when={params.id && !root()?.parentID}>
      <Show when={question()} keyed>
        {(pending) => (
          <div data-component="worker-native-question">
            <p class="text-12 text-text-weak px-3">{language.t("session.workers.forTask", { title: pending.title })}</p>
            <SessionQuestionDock
              request={pending.request}
              onSubmit={() => void refresh()}
              reply={(answers) =>
                api()
                  .answer({
                    sessionID: params.id ?? "",
                    interactionID: pending.interaction.id,
                    generation: pending.interaction.generation,
                    decision: { kind: "question", answers },
                  })
                  .then(() => refresh())
              }
              reject={() =>
                api()
                  .answer({
                    sessionID: params.id ?? "",
                    interactionID: pending.interaction.id,
                    generation: pending.interaction.generation,
                    decision: { kind: "question-rejection" },
                  })
                  .then(() => refresh())
              }
            />
          </div>
        )}
      </Show>
      <Show when={permission()} keyed>
        {(pending) => (
          <div data-component="worker-native-permission">
            <p class="text-12 text-text-weak px-3">{language.t("session.workers.forTask", { title: pending.title })}</p>
            <SessionPermissionDock
              request={pending.request}
              responding={store.busy === pending.interaction.id}
              onDecide={(reply) =>
                void action(pending.interaction.id, () =>
                  api().answer({
                    sessionID: params.id ?? "",
                    interactionID: pending.interaction.id,
                    generation: pending.interaction.generation,
                    decision: { kind: "permission", reply },
                  }),
                )
              }
            />
          </div>
        )}
      </Show>
      <section
        data-component="session-worker-dock"
        class="mb-2 rounded-md border border-border-weak-base bg-background-base/60 text-12"
        aria-label={language.t("session.workers.forChat", { title: root()?.title ?? "" })}
      >
        <div class="flex items-center gap-2 px-3 py-2">
          <Button size="small" variant="ghost" aria-expanded={store.open} onClick={() => set("open", !store.open)}>
            {language.t("session.workers.title")}
          </Button>
          <span class="text-text-weak">{language.t("session.workers.assigned", { count: count() })}</span>
          <Show when={(store.counts.queued ?? 0) > 0}>
            <span class="text-text-weak">
              {language.t("session.workers.queued", { count: store.counts.queued ?? 0 })}
            </span>
          </Show>
          <div class="ms-auto">
            <Button
              size="small"
              variant="ghost"
              disabled={!store.supported || !!store.busy}
              onClick={() => set({ open: true, form: !store.form })}
            >
              {language.t("session.workers.new")}
            </Button>
          </div>
        </div>
        <Show when={store.open}>
          <div class="px-3 pb-3 flex flex-col gap-2">
            <Show when={store.supported} fallback={<p>{language.t("session.workers.unavailable")}</p>}>
              <div class="flex gap-2">
                <Button
                  size="small"
                  variant="ghost"
                  disabled={!!store.busy}
                  onClick={() =>
                    void action("pause", () =>
                      store.paused
                        ? api().resume({ sessionID: params.id ?? "" })
                        : api().pause({ sessionID: params.id ?? "" }),
                    )
                  }
                >
                  {language.t(store.paused ? "session.workers.resume" : "session.workers.pause")}
                </Button>
                <Button size="small" variant="ghost" onClick={() => void refresh()}>
                  {language.t("session.workers.refresh")}
                </Button>
              </div>
              <Show when={store.form}>
                <form class="flex flex-col gap-2" onSubmit={(event) => void dispatch(event)}>
                  <label>
                    {language.t("session.workers.taskTitle")}
                    <input
                      class={field}
                      required
                      maxLength={200}
                      value={store.title}
                      onInput={(event) => set({ title: event.currentTarget.value, dispatchKey: "" })}
                    />
                  </label>
                  <label>
                    {language.t("session.workers.objective")}
                    <textarea
                      class={field}
                      required
                      rows={3}
                      maxLength={20_000}
                      value={store.objective}
                      onInput={(event) => set({ objective: event.currentTarget.value, dispatchKey: "" })}
                    />
                  </label>
                  <label>
                    {language.t("session.workers.checks")}
                    <textarea
                      class={field}
                      required
                      rows={2}
                      value={store.checks}
                      onInput={(event) => set({ checks: event.currentTarget.value, dispatchKey: "" })}
                    />
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <label>
                      {language.t("session.workers.mode")}
                      <select
                        class={field}
                        value={store.mode}
                        onChange={(event) => {
                          const mode = event.currentTarget.value
                          if (mode === "native" || mode === "report" || mode === "research" || mode === "coding")
                            set({ mode, dispatchKey: "" })
                        }}
                      >
                        <option value="native">{language.t("session.workers.native")}</option>
                        <option value="report">{language.t("session.workers.report")}</option>
                        <option value="research">{language.t("session.workers.research")}</option>
                        <option value="coding">{language.t("session.workers.coding")}</option>
                      </select>
                    </label>
                    <label>
                      {language.t("session.workers.agent")}
                      <select
                        class={field}
                        value={selectedAgent()}
                        onChange={(event) => set({ agent: event.currentTarget.value, dispatchKey: "" })}
                      >
                        <For each={agents()}>{(agent) => <option value={agent.name}>{agent.name}</option>}</For>
                      </select>
                    </label>
                  </div>
                  <Show when={store.mode === "native"}>
                    <p class="text-text-weak">{language.t("session.workers.nativeScope")}</p>
                  </Show>
                  <Show when={store.mode === "coding"}>
                    <label>
                      {language.t("session.workers.paths")}
                      <textarea
                        class={field}
                        required
                        value={store.paths}
                        onInput={(event) => set({ paths: event.currentTarget.value, dispatchKey: "" })}
                      />
                    </label>
                  </Show>
                  <div class="grid grid-cols-2 gap-2">
                    <label>
                      {language.t("session.workers.calls")}
                      <input
                        class={field}
                        type="number"
                        min={1}
                        max={100}
                        required
                        value={store.calls}
                        onInput={(event) => set({ calls: event.currentTarget.valueAsNumber, dispatchKey: "" })}
                      />
                    </label>
                    <label>
                      {language.t("session.workers.minutes")}
                      <input
                        class={field}
                        type="number"
                        min={1}
                        max={1440}
                        required
                        value={store.minutes}
                        onInput={(event) => set({ minutes: event.currentTarget.valueAsNumber, dispatchKey: "" })}
                      />
                    </label>
                  </div>
                  <p class="text-text-weak">
                    {language.t("session.workers.model", { model: local.model.current()?.name ?? "" })}
                  </p>
                  <p class="text-text-weak">{language.t("session.workers.reviewRequired")}</p>
                  <Button type="submit" size="small" disabled={!!store.busy}>
                    {language.t("session.workers.dispatch")}
                  </Button>
                </form>
              </Show>
              <Show when={store.items.length === 0}>
                <p class="text-text-weak">{language.t("session.workers.empty")}</p>
              </Show>
              <div class="max-h-72 overflow-auto flex flex-col gap-2">
                <For each={store.items}>
                  {(item) => (
                    <article class="rounded border border-border-weak-base p-2" data-task-id={item.task.id}>
                      <div class="flex items-center gap-2">
                        <bdi dir="auto" class="font-medium">
                          {item.task.brief.title}
                        </bdi>
                        <span class="text-text-weak">{language.t(labels[item.task.status])}</span>
                        <Show when={!(["completed", "failed", "cancelled"] as string[]).includes(item.task.status)}>
                          <Button
                            size="small"
                            variant="ghost"
                            class="ms-auto"
                            disabled={!!store.busy}
                            onClick={() =>
                              void action(item.task.id, () =>
                                api().cancel({ sessionID: params.id ?? "", taskID: item.task.id }),
                              )
                            }
                          >
                            {language.t("session.workers.cancel")}
                          </Button>
                        </Show>
                      </div>
                      <Show
                        when={
                          (root()?.agent !== "michael-lead" && root()?.agent !== "dispatcher") ||
                          item.task.brief.execution?.agent === "michael"
                        }
                      >
                        <Show when={item.task.status === "interrupted"}>
                          <p class="text-text-weak">{language.t("session.workers.interrupted")}</p>
                          <label class="flex items-start gap-2 mt-2">
                            <input
                              type="checkbox"
                              checked={!!store.recovery[item.id]?.stopped}
                              onChange={(event) =>
                                set("recovery", item.id, {
                                  ...store.recovery[item.id],
                                  stopped: event.currentTarget.checked,
                                })
                              }
                            />
                            {language.t("session.workers.confirmStopped")}
                          </label>
                          <Show when={item.task.brief.execution?.mode === "coding"}>
                            <label class="flex items-start gap-2 mt-2">
                              <input
                                type="checkbox"
                                checked={!!store.recovery[item.id]?.reviewed}
                                onChange={(event) =>
                                  set("recovery", item.id, {
                                    ...store.recovery[item.id],
                                    reviewed: event.currentTarget.checked,
                                  })
                                }
                              />
                              {language.t("session.workers.reviewedChanges")}
                            </label>
                          </Show>
                        </Show>
                        <Show
                          when={
                            (item.task.status === "interrupted" || item.task.status === "failed") &&
                            item.task.brief.execution?.mode === "native"
                          }
                        >
                          <label class="flex items-start gap-2 mt-2">
                            <input
                              type="checkbox"
                              checked={!!store.recovery[item.id]?.reviewed}
                              onChange={(event) =>
                                set("recovery", item.id, {
                                  ...store.recovery[item.id],
                                  reviewed: event.currentTarget.checked,
                                })
                              }
                            />
                            {language.t("session.workers.reviewedChanges")}
                          </label>
                        </Show>
                        <Show when={item.task.status === "failed" || item.task.status === "interrupted"}>
                          <Button
                            size="small"
                            variant="ghost"
                            disabled={
                              !!store.busy ||
                              (item.task.brief.execution?.mode === "native" && !store.recovery[item.id]?.reviewed) ||
                              (item.task.status === "interrupted" &&
                                (!store.recovery[item.id]?.stopped ||
                                  (item.task.brief.execution?.mode === "coding" && !store.recovery[item.id]?.reviewed)))
                            }
                            onClick={() =>
                              void action(item.id, () =>
                                api().retry({
                                  sessionID: params.id ?? "",
                                  taskID: item.task.id,
                                  generation: item.task.generation,
                                  confirmStopped: store.recovery[item.id]?.stopped,
                                  reviewedChanges: store.recovery[item.id]?.reviewed,
                                }),
                              )
                            }
                          >
                            {language.t("session.workers.retry")}
                          </Button>
                        </Show>
                      </Show>
                      <Show when={item.evidence}>
                        <details open class="mt-1">
                          <summary>{language.t("session.workers.result")}</summary>
                          <Show
                            when={workerEvidence(item.evidence ?? "")}
                            keyed
                            fallback={
                              <pre
                                dir="auto"
                                class="whitespace-pre-wrap break-words max-h-52 overflow-auto text-text-weak"
                              >
                                {item.evidence}
                              </pre>
                            }
                          >
                            {(result) => (
                              <div
                                dir="auto"
                                class="whitespace-pre-wrap break-words max-h-52 overflow-auto text-text-weak"
                              >
                                <p>{result.summary}</p>
                                <For each={result.checks}>
                                  {(check) => (
                                    <div class="mt-2">
                                      <p>
                                        {language.t(labels[check.passed ? "completed" : "failed"])}: {check.check}
                                      </p>
                                      <p>{check.evidence}</p>
                                    </div>
                                  )}
                                </For>
                              </div>
                            )}
                          </Show>
                        </details>
                      </Show>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </section>
    </Show>
  )
}
