import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { GoalAction, SessionGoalView } from "./session-composer-state"

export function goalDockState(goal: { status: "active" | "paused" | "completed" } | undefined) {
  return goal ? "visible" : "hidden"
}

export function elapsedParts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 }
}

export function formatElapsed(
  ms: number,
  t: (
    key: "session.goal.elapsed.hours" | "session.goal.elapsed.minutes" | "session.goal.elapsed.seconds",
    params: Record<string, string>,
  ) => string,
) {
  const { hours, minutes, seconds } = elapsedParts(ms)
  if (hours > 0) return t("session.goal.elapsed.hours", { hours: String(hours), minutes: String(minutes) })
  if (minutes > 0) return t("session.goal.elapsed.minutes", { minutes: String(minutes), seconds: String(seconds) })
  return t("session.goal.elapsed.seconds", { seconds: String(seconds) })
}

export function goalProgress(todos: ReadonlyArray<{ status: string }>) {
  const done = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  return { done, total: todos.length }
}

function GoalButton(props: { label: string; disabled: boolean; onClick: () => void; children: () => JSX.Element }) {
  return (
    <button
      type="button"
      class="flex size-7 items-center justify-center rounded-md text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-hover hover:text-v2-text-text-base disabled:opacity-40"
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children()}
    </button>
  )
}

export function SessionGoalDock(props: {
  goal: SessionGoalView | undefined
  todos: ReadonlyArray<{ status: string }>
  busy: boolean
  onAction: (action: GoalAction) => void
}) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  let timer: number | undefined

  onMount(() => {
    timer = window.setInterval(() => setNow(Date.now()), 1000)
  })
  onCleanup(() => {
    if (timer !== undefined) window.clearInterval(timer)
  })

  const visible = createMemo(() => (goalDockState(props.goal) === "visible" ? props.goal : undefined))
  const progress = createMemo(() => goalProgress(props.todos))
  const elapsed = createMemo(() => {
    const goal = props.goal
    if (!goal?.started || goal.status === "completed") return
    return formatElapsed(now() - goal.started, language.t)
  })
  const label = createMemo(() => {
    const status = props.goal?.status
    if (status === "completed") return language.t("session.goal.completed")
    if (status === "paused") return language.t("session.goal.paused")
    return language.t("session.goal.active")
  })

  return (
    <Show when={visible()}>
      {(goal) => (
        <div
          data-component="session-goal-dock"
          data-status={goal().status}
          class="pointer-events-auto mb-2 flex min-h-10 w-full items-center gap-2 rounded-xl border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
        >
          <span
            class="size-2 shrink-0 rounded-full bg-v2-text-text-base"
            classList={{ "animate-pulse": goal().status === "active", "opacity-40": goal().status === "paused" }}
          />
          <span class="shrink-0 text-[13px] font-[440] leading-5 text-v2-text-text-muted">{label()}</span>
          <span
            class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-5 text-v2-text-text-faint"
            title={goal().evidence ?? goal().objective}
          >
            {goal().objective}
          </span>
          <Show when={progress().total > 0}>
            <span class="shrink-0 tabular-nums text-[12px] leading-5 text-v2-text-text-faint" aria-hidden="true">
              {progress().done}/{progress().total}
            </span>
          </Show>
          <Show when={elapsed()}>
            {(value) => (
              <span class="shrink-0 tabular-nums text-[12px] leading-5 text-v2-text-text-faint" aria-hidden="true">
                {value()}
              </span>
            )}
          </Show>
          <div class="flex shrink-0 items-center gap-0.5">
            <Show when={goal().status !== "completed"}>
              <GoalButton
                label={goal().status === "active" ? language.t("session.goal.pause") : language.t("session.goal.resume")}
                disabled={props.busy}
                onClick={() => props.onAction(goal().status === "active" ? "pause" : "resume")}
              >
                {() => <Icon name={goal().status === "active" ? "stop" : "arrow-right"} class="size-4" />}
              </GoalButton>
            </Show>
            <GoalButton
              label={language.t("session.goal.clear")}
              disabled={props.busy}
              onClick={() => props.onAction("clear")}
            >
              {() => <Icon name="trash" class="size-4" />}
            </GoalButton>
          </div>
        </div>
      )}
    </Show>
  )
}
