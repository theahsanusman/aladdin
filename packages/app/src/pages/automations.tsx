import type { Automation } from "@opencode-ai/schema/automation"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { useTabs } from "@/context/tabs"
import { legacySessionHref, sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"
import {
  createAutomationApi,
  errorMessage,
  formatRelative,
  formatSchedule,
  type AutomationOverview,
  type CreateAutomationInput,
} from "@/utils/automation"

type Group = AutomationOverview & { directory: string }

export function AutomationsPage() {
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const layout = useLayout()
  const language = useLanguage()
  const dialog = useDialog()

  // Automations are stored per directory, so the page needs every directory the
  // server knows about, not just the projects opened locally in this window.
  const directories = createMemo(() => {
    const seen = new Set<string>()
    const add = (project: { worktree?: string; sandboxes?: readonly string[] }) => {
      if (project.worktree) seen.add(project.worktree)
      for (const sandbox of project.sandboxes ?? []) seen.add(sandbox)
    }
    for (const project of layout.projects.list()) add(project)
    for (const project of serverSync().data.project) add(project)
    return [...seen]
  })

  const api = createMemo(() => createAutomationApi(serverSDK().request))

  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const toggleRuns = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const [groups, { refetch }] = createResource(directories, async (dirs) => {
    const overviews = await Promise.all(
      dirs.map(async (directory) => ({ directory, ...(await api().list(directory)) })),
    )
    return overviews.filter((group) => group.automations.length > 0)
  })

  createEffect(() => {
    const unsub = serverSDK().event.listen((event) => {
      const type = (event.details as { type: string }).type
      if (type !== "automation.updated" && type !== "automation.run.updated") return
      void refetch()
    })
    onCleanup(unsub)
  })

  async function withError(action: () => Promise<void>, fallback: string) {
    try {
      await action()
    } catch (error) {
      showToast({ title: fallback, description: errorMessage(error, fallback) })
    }
  }

  const openCreate = () => {
    const dirs = directories()
    if (dirs.length === 0) {
      showToast({ title: language.t("automations.empty.title") })
      return
    }
    dialog.show(() => (
      <CreateAutomationDialog
        directories={dirs}
        onSubmit={(directory, payload) =>
          withError(async () => {
            await api().create(directory, payload)
            await refetch()
            showToast({ title: language.t("automations.toast.created") })
          }, language.t("automations.error.create"))
        }
      />
    ))
  }

  const markAllRead = () =>
    withError(async () => {
      for (const directory of directories()) await api().read(directory)
      await refetch()
    }, language.t("automations.error.read"))

  const unread = createMemo(() => (groups() ?? []).reduce((total, group) => total + group.runs.filter((run) => run.unread).length, 0))

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-v2-background-bg-base">
      <header class="flex shrink-0 flex-col gap-3 border-b border-v2-border-border-base px-6 py-4">
        <div class="flex min-w-0 items-center justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1">
            <h1 class="text-16-medium text-v2-text-text-base">{language.t("automations.title")}</h1>
            <p class="text-12-regular text-v2-text-text-muted">{language.t("automations.description")}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Show when={unread() > 0}>
              <ButtonV2 variant="ghost" size="small" onClick={markAllRead}>
                {language.t("automations.action.markAllRead")}
              </ButtonV2>
            </Show>
            <ButtonV2 variant="outline" size="small" icon="outline-reset" onClick={() => void refetch()}>
              {language.t("automations.action.refresh")}
            </ButtonV2>
            <ButtonV2 variant="contrast" size="small" icon="plus" onClick={openCreate}>
              {language.t("automations.action.create")}
            </ButtonV2>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Show when={groups.error}>
          {(error) => (
            <div class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3 text-12-regular text-v2-text-text-muted">
              {errorMessage(error(), language.t("automations.error.load"))}
            </div>
          )}
        </Show>

        <Show when={!groups.loading && !groups.error && (groups() ?? []).length === 0}>
          <div class="flex flex-col items-center gap-2 py-16 text-center">
            <IconV2 name="status-active" size="large" class="text-v2-icon-icon-muted" />
            <p class="text-13-medium text-v2-text-text-base">{language.t("automations.empty.title")}</p>
            <p class="max-w-[420px] text-12-regular text-v2-text-text-muted">{language.t("automations.empty.description")}</p>
            <ButtonV2 variant="outline" size="small" icon="plus" onClick={openCreate}>
              {language.t("automations.action.create")}
            </ButtonV2>
          </div>
        </Show>

        <div class="flex min-w-0 flex-col gap-6">
          <For each={groups() ?? []}>
            {(group) => (
              <section class="flex min-w-0 flex-col gap-2">
                <div class="flex min-w-0 items-baseline gap-2">
                  <span class="truncate text-12-medium text-v2-text-text-base">{baseName(group.directory)}</span>
                  <span class="truncate text-11-regular text-v2-text-text-faint" dir="auto">
                    {group.directory}
                  </span>
                </div>
                <div class="flex min-w-0 flex-col gap-2">
                  <For each={group.automations}>
                    {(automation) => (
                      <AutomationRow
                        automation={automation}
                        runs={group.runs.filter((run) => run.automationID === automation.id)}
                        expanded={expanded().has(automation.id)}
                        onToggleRuns={() => toggleRuns(automation.id)}
                        onRun={() =>
                          withError(async () => {
                            await api().run(group.directory, automation.id)
                            await refetch()
                            showToast({ title: language.t("automations.toast.started") })
                          }, language.t("automations.error.run"))
                        }
                        onToggle={() =>
                          withError(async () => {
                            await api().update(group.directory, automation.id, {
                              status: automation.status === "active" ? "paused" : "active",
                            })
                            await refetch()
                          }, language.t("automations.error.update"))
                        }
                        onDelete={() =>
                          withError(async () => {
                            await api().remove(group.directory, automation.id)
                            await refetch()
                            showToast({ title: language.t("automations.toast.deleted") })
                          }, language.t("automations.error.delete"))
                        }
                      />
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

function baseName(directory: string) {
  const parts = directory.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? directory
}

function outcomeKey(outcome: Automation.Outcome | undefined) {
  switch (outcome) {
    case "verified":
      return "automations.outcome.verified"
    case "verification_failed":
      return "automations.outcome.verificationFailed"
    case "budget_exceeded":
      return "automations.outcome.budgetExceeded"
    case "budget_exhausted":
      return "automations.outcome.budgetExhausted"
    case "timed_out":
      return "automations.outcome.timedOut"
    case "provider_error":
      return "automations.outcome.providerError"
    case "cancelled":
      return "automations.outcome.cancelled"
    case "previous_run_active":
      return "automations.outcome.previousRunActive"
    case "project_unavailable":
      return "automations.outcome.projectUnavailable"
    case "session_unavailable":
      return "automations.outcome.sessionUnavailable"
    default:
      return "automations.outcome.reported"
  }
}

function AutomationRow(props: {
  automation: Automation.Info
  runs: Automation.Run[]
  expanded: boolean
  onToggleRuns: () => void
  onRun: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const sorted = createMemo(() => [...props.runs].sort((a, b) => b.time.created - a.time.created))
  const last = createMemo(() => sorted()[0])
  const unseen = createMemo(() => props.runs.some((run) => run.unread))

  return (
    <div class="flex min-w-0 flex-col rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01">
      <div class="flex min-w-0 items-start gap-3 px-4 py-3">
        <div class="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <Show when={unseen()}>
            <span class="size-2 rounded-full bg-v2-background-bg-accent" />
          </Show>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="truncate text-13-medium text-v2-text-text-base">{props.automation.name}</span>
            <Tag variant={props.automation.status === "active" ? "accent" : "neutral"}>
              {language.t(props.automation.status === "active" ? "automations.status.active" : "automations.status.paused")}
            </Tag>
            <Tag>{props.automation.profile}</Tag>
            <Show when={props.automation.verification.length > 0}>
              <Tag>{language.t("automations.badge.verified")}</Tag>
            </Show>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-11-regular text-v2-text-text-muted">
            <span>{formatSchedule(props.automation.schedule)}</span>
            <Show when={props.automation.nextRunAt}>
              {(nextRunAt) => (
                <span>{language.t("automations.nextRun", { time: formatRelative(nextRunAt()) })}</span>
              )}
            </Show>
            <Show when={last()}>
              {(run) => (
                <span>
                  {language.t("automations.lastRun", {
                    outcome: language.t(outcomeKey(run().outcome)),
                    time: formatRelative(run().time.finished ?? run().time.created),
                  })}
                </span>
              )}
            </Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <ButtonV2 variant="ghost" size="small" icon="play" onClick={props.onRun} title={language.t("automations.action.runNow")}>
            {language.t("automations.action.runNow")}
          </ButtonV2>
          <ButtonV2 variant="ghost" size="small" onClick={props.onToggle}>
            {language.t(props.automation.status === "active" ? "automations.action.pause" : "automations.action.resume")}
          </ButtonV2>
          <ButtonV2 variant="ghost-muted" size="small" onClick={props.onDelete}>
            {language.t("automations.action.delete")}
          </ButtonV2>
          <ButtonV2 variant="ghost-muted" size="small" onClick={props.onToggleRuns}>
            {language.t(props.expanded ? "automations.action.hideRuns" : "automations.action.showRuns")}
          </ButtonV2>
        </div>
      </div>

      <Show when={props.expanded}>
        <DividerV2 />
        <Show
          when={sorted().length > 0}
          fallback={<div class="px-4 py-3 text-11-regular text-v2-text-text-faint">{language.t("automations.runs.empty")}</div>}
        >
          <div class="flex flex-col">
            <For each={sorted().slice(0, 10)}>
              {(run) => <RunRow run={run} directory={props.automation.directory} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function RunRow(props: { run: Automation.Run; directory: string }) {
  const language = useLanguage()
  const global = useGlobal()
  const server = useServer()
  const tabs = useTabs()
  const settings = useSettings()
  const navigate = useNavigate()

  const open = () => {
    const sessionID = props.run.sessionID
    if (!sessionID) return
    const conn = server.current
    if (!conn) return
    if (!settings.general.newLayoutDesigns()) {
      navigate(legacySessionHref(props.directory, sessionID))
      return
    }
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(props.directory)
    ctx.projects.touch(props.directory)
    const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: sessionID })
    navigate(sessionHref(ServerConnection.key(conn), sessionID))
    tabs.select(tab)
  }

  return (
    <div class="flex min-w-0 items-start gap-3 border-t border-v2-border-border-base px-4 py-2 first:border-t-0">
      <div class="mt-1 flex size-3 shrink-0 items-center justify-center">
        <Show when={props.run.unread}>
          <span class="size-1.5 rounded-full bg-v2-background-bg-accent" />
        </Show>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 flex-wrap items-center gap-2 text-11-regular text-v2-text-text-muted">
          <Tag variant={props.run.status === "failed" ? "neutral" : "accent"}>{language.t(outcomeKey(props.run.outcome))}</Tag>
          <span>{formatRelative(props.run.time.finished ?? props.run.time.created)}</span>
          <Show when={props.run.tokensTotal > 0}>
            <span>{language.t("automations.run.tokens", { count: props.run.tokensTotal })}</span>
          </Show>
          <span>{props.run.trigger}</span>
        </div>
        <Show when={props.run.summary}>
          <p class="line-clamp-3 whitespace-pre-wrap break-words text-11-regular text-v2-text-text-base" dir="auto">
            {props.run.summary}
          </p>
        </Show>
      </div>
      <Show when={props.run.sessionID}>
        <ButtonV2 variant="ghost-muted" size="small" onClick={open}>
          {language.t("automations.run.openSession")}
        </ButtonV2>
      </Show>
    </div>
  )
}

function CreateAutomationDialog(props: {
  directories: string[]
  onSubmit: (directory: string, payload: CreateAutomationInput) => Promise<void>
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [form, setForm] = createStore({
    directory: props.directories[0] ?? "",
    name: "",
    prompt: "",
    schedule: "daily at 08:00",
    profile: "workspace-write" as Automation.Profile,
    verification: "",
    budgetPerRunTokens: "",
    budgetPerDayTokens: "",
    timeoutMinutes: "",
  })
  const [busy, setBusy] = createSignal(false)

  const profiles: Automation.Profile[] = ["read-only", "workspace-write", "full"]

  const canSubmit = () => form.directory.length > 0 && form.prompt.trim().length > 0 && form.schedule.trim().length > 0

  const submit = async () => {
    if (!canSubmit() || busy()) return
    setBusy(true)
    try {
      await props.onSubmit(form.directory, {
        name: form.name.trim() || undefined,
        prompt: form.prompt.trim(),
        schedule: form.schedule.trim(),
        profile: form.profile,
        verification: form.verification
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        budgetPerRunTokens: form.budgetPerRunTokens ? Number(form.budgetPerRunTokens) : undefined,
        budgetPerDayTokens: form.budgetPerDayTokens ? Number(form.budgetPerDayTokens) : undefined,
        timeoutMinutes: form.timeoutMinutes ? Number(form.timeoutMinutes) : undefined,
      })
      dialog.close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog fit class="w-[560px] max-w-[92vw]">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("automations.dialog.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pb-2 pt-4">
        <Field label={language.t("automations.dialog.directory")}>
          <SelectV2
            options={props.directories}
            current={form.directory}
            value={(item) => item}
            label={(item) => baseName(item)}
            onSelect={(value) => value && setForm("directory", value)}
          />
        </Field>
        <Field label={language.t("automations.dialog.prompt")}>
          <TextareaV2
            value={form.prompt}
            placeholder={language.t("automations.dialog.promptPlaceholder")}
            onInput={(event) => setForm("prompt", event.currentTarget.value)}
          />
        </Field>
        <Field label={language.t("automations.dialog.schedule")} hint={language.t("automations.dialog.scheduleHint")}>
          <TextInputV2
            type="text"
            value={form.schedule}
            onInput={(event) => setForm("schedule", event.currentTarget.value)}
          />
        </Field>
        <Field label={language.t("automations.dialog.profile")} hint={language.t("automations.dialog.profileHint")}>
          <SelectV2
            options={profiles}
            current={form.profile}
            value={(item) => item}
            label={(item) => item}
            onSelect={(value) => value && setForm("profile", value)}
          />
        </Field>
        <Field label={language.t("automations.dialog.name")}>
          <TextInputV2
            type="text"
            value={form.name}
            placeholder={language.t("automations.dialog.namePlaceholder")}
            onInput={(event) => setForm("name", event.currentTarget.value)}
          />
        </Field>
        <Field label={language.t("automations.dialog.verification")} hint={language.t("automations.dialog.verificationHint")}>
          <TextareaV2
            value={form.verification}
            placeholder={"bun test\nbun run typecheck"}
            onInput={(event) => setForm("verification", event.currentTarget.value)}
          />
        </Field>
        <div class="flex min-w-0 items-end gap-3">
          <Field label={language.t("automations.dialog.budgetPerRun")} class="flex-1">
            <TextInputV2
              type="number"
              value={form.budgetPerRunTokens}
              onInput={(event) => setForm("budgetPerRunTokens", event.currentTarget.value)}
            />
          </Field>
          <Field label={language.t("automations.dialog.budgetPerDay")} class="flex-1">
            <TextInputV2
              type="number"
              value={form.budgetPerDayTokens}
              onInput={(event) => setForm("budgetPerDayTokens", event.currentTarget.value)}
            />
          </Field>
          <Field label={language.t("automations.dialog.timeout")} class="flex-1">
            <TextInputV2
              type="number"
              value={form.timeoutMinutes}
              onInput={(event) => setForm("timeoutMinutes", event.currentTarget.value)}
            />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" size="small" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" size="small" disabled={!canSubmit() || busy()} onClick={() => void submit()}>
          {language.t("automations.dialog.create")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}

function Field(props: { label: string; hint?: string; class?: string; children: import("solid-js").JSX.Element }) {
  return (
    <div class={`flex min-w-0 flex-col gap-1.5 ${props.class ?? ""}`}>
      <span class="text-11-medium text-v2-text-text-muted">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-11-regular text-v2-text-text-faint">{props.hint}</span>
      </Show>
    </div>
  )
}
