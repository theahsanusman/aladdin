import { createEffect, createMemo, createRoot, getOwner, on, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { sendFollowupDraft, type FollowupDraft } from "@/components/prompt-input/followup"
import { Persist, persisted } from "@/utils/persist"
import { pathKey } from "@/utils/path-key"
import { Identifier } from "@/utils/id"
import type { Platform } from "./platform"
import type { ServerSDK } from "./server-sdk"
import type { createServerSyncContextInner } from "./server-sync"
import { loadCommands } from "./global-sync/bootstrap"
import { createFollowupQueue } from "./followup-queue"
import { isDetachedWorkerSession, sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"

export type FollowupItem = FollowupDraft & { id: string; messageID?: string }
export type FollowupState = {
  items: Record<string, FollowupItem[] | undefined>
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
  edit: Record<string, Pick<FollowupItem, "id" | "prompt" | "context"> | undefined>
}

/** Server-lifetime queue ownership survives chat, workspace, and home navigation. */
export function createFollowups(input: {
  sdk: ServerSDK
  sync: ReturnType<typeof createServerSyncContextInner>
  platform: Platform
  onError: (error: unknown) => void
}) {
  const owner = getOwner()
  const sessions = createMemo(() =>
    Object.values(input.sync.session.data.info).filter((session) => session !== undefined),
  )
  const workspaces = new Map<string, ReturnType<typeof createWorkspace>>()
  const disposers: VoidFunction[] = []
  const [directories, setDirectories, , ready] = persisted(
    Persist.serverGlobal(input.sdk.scope, "followup-directories"),
    createStore({ items: [] as string[] }),
    input.platform,
  )

  const workspace = (directory: string) => {
    const key = pathKey(directory)
    const existing = workspaces.get(key)
    if (existing) return existing
    const next = createRoot((dispose) => {
      disposers.push(dispose)
      return createWorkspace(directory)
    }, owner)
    workspaces.set(key, next)
    const remember = () => {
      if (directories.items.some((item) => pathKey(item) === key)) return
      setDirectories("items", (items) => [...items, directory])
    }
    if (ready()) remember()
    if (!ready()) void ready.promise?.then(remember)
    return next
  }

  function createWorkspace(directory: string) {
    const sdk = input.sdk.ensureDirSdkContext(directory)
    const [store, set, , loaded] = persisted(
      Persist.serverWorkspace(input.sdk.scope, directory, "followup", ["followup.v1"]),
      createStore<FollowupState>({ items: {}, failed: {}, paused: {}, edit: {} }),
      input.platform,
    )
    const [sending, setSending] = createStore<Record<string, string[] | undefined>>({})
    const queue = createFollowupQueue({
      items: () => store.items,
      eligible: (item, manual) => {
        if (!loaded() || !input.sync.ready) return false
        if (input.sync.session.get(item.sessionID)?.parentID) return false
        if (manual) return true
        if (store.failed[item.sessionID] === item.id || store.paused[item.sessionID]) return false
        return !sessionPermissionRequest(
          sessions(),
          input.sync.session.data.permission,
          item.sessionID,
          (request) => !isDetachedWorkerSession(sessions(), item.sessionID, request.sessionID),
        )
      },
      busy: async () => {
        if ((await input.sdk.protocol) === "v1") {
          const result = await sdk.client.session.status()
          for (const id of Object.keys(store.items)) {
            if (!sending[id]?.length)
              input.sync.session.set("session_status", id, result.data?.[id] ?? { type: "idle" })
          }
          return new Set(
            Object.entries(result.data ?? {})
              .filter(([, status]) => status.type !== "idle")
              .map(([id]) => id),
          )
        }
        const result = await sdk.api.session.active()
        for (const id of Object.keys(store.items)) {
          if (!sending[id]?.length)
            input.sync.session.set("session_status", id, { type: id in result ? "busy" : "idle" })
        }
        return new Set(Object.keys(result))
      },
      send: async (item, manual) => {
        if (manual) set("paused", item.sessionID, undefined)
        set("failed", item.sessionID, undefined)
        // Message IDs order transcript history. Allocate at dispatch, then persist the
        // identity for retries; a draft may have been queued before later assistant turns.
        const messageID = item.messageID ?? Identifier.ascending("message")
        set("items", item.sessionID, (entry) => entry.id === item.id, "messageID", messageID)
        // A persisted queue needs prompt admission, not a mounted workspace with
        // providers, LSP and MCP processes. Resolve slash commands only on demand.
        const command = item.prompt
          .map((part) => ("content" in part ? part.content : ""))
          .join("")
          .startsWith("/")
          ? await loadCommands(directory, input.sdk.api.command, sdk.client, input.sdk.protocol)
          : []
        return sendFollowupDraft({
          api: {
            command: sdk.api.session.command,
            prompt: async (value) => {
              if ((await input.sdk.protocol) !== "v1") return sdk.api.session.prompt(value)
              // V1 has no durable queue admission. Hold this chat's claim until its turn
              // completes, rather than treating prompt_async's 204 as completion.
              const request = {
                sessionID: value.sessionID,
                messageID: value.id ?? undefined,
                agent: value.agent,
                model: value.model,
                variant: value.variant,
                parts: value.legacyParts ?? [{ type: "text", text: value.text }],
              }
              if (manual) return sdk.client.session.promptAsync(request)
              return sdk.client.session.prompt(request)
            },
          },
          sync: { data: { command }, session: input.sync.session },
          serverSync: input.sync,
          draft: item,
          messageID,
          delivery: manual ? "steer" : "queue",
          optimisticBusy: true,
        })
      },
      remove: (item) =>
        set("items", item.sessionID, (items) => {
          const next = (items ?? []).filter((entry) => entry.id !== item.id)
          return next.length ? next : undefined
        }),
      fail: (item, error) => {
        set("failed", item.sessionID, item.id)
        input.onError(error)
      },
      sending: (sessionID, id, active) =>
        setSending(sessionID, (ids) => {
          const next = active ? [...(ids ?? []), id] : (ids ?? []).filter((entry) => entry !== id)
          return next.length ? next : undefined
        }),
    })
    const drain = () => void queue.drain().catch(() => undefined)
    // Events start the next turn promptly; polling also repairs a missed idle event.
    createEffect(
      on(
        () => ({
          loaded: loaded(),
          ready: input.sync.ready,
          items: Object.values(store.items).flatMap((items) => {
            const item = items?.[0]
            if (!item) return []
            return [
              {
                id: item.id,
                failed: store.failed[item.sessionID],
                paused: store.paused[item.sessionID],
                sending: sending[item.sessionID],
                working: input.sync.session.data.session_working(item.sessionID),
                permission: sessionPermissionRequest(sessions(), input.sync.session.data.permission, item.sessionID),
              },
            ]
          }),
        }),
        drain,
      ),
    )
    createEffect(() => {
      if (!loaded() || !input.sync.ready) return
      const pending = Object.values(store.items).some((items) => {
        const item = items?.[0]
        return item && !store.paused[item.sessionID] && store.failed[item.sessionID] !== item.id
      })
      if (!pending) return
      const timer = setInterval(drain, 5_000)
      onCleanup(() => clearInterval(timer))
    })
    onCleanup(queue.dispose)
    return { store, set, sending, send: queue.send }
  }

  createEffect(() => {
    if (!ready()) return
    for (const directory of directories.items) untrack(() => workspace(directory))
  })
  createEffect(() => {
    if (!input.sync.ready) return
    // Load old workspace queues even when their chat is not the selected tab.
    for (const project of input.sync.data.project) untrack(() => workspace(project.worktree))
  })
  onCleanup(() => disposers.forEach((dispose) => dispose()))
  return { workspace }
}
