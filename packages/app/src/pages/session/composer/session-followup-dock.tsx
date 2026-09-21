import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  createSortable,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ConstrainDragXAxis, getDraggableId } from "@/utils/solid-dnd"
import { useLanguage } from "@/context/language"
import { followupDragIndex } from "./followup-order"

export function SessionFollowupDock(props: {
  items: { id: string; text: string }[]
  sending?: string
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onReorder: (id: string, toIndex: number) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
  })

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() => language.plural("session.followupDock.summary", total()))
  const preview = createMemo(() => props.items[0]?.text ?? "")

  const handleDragEnd = (event: DragEvent) => {
    if (props.sending) return
    const source = getDraggableId(event)
    const target = event.droppable?.id
    if (!source || target === undefined) return
    const toIndex = followupDragIndex(props.items, source, target.toString())
    if (toIndex === undefined) return
    props.onReorder(source, toIndex)
  }

  return (
    <DockTray
      data-component="session-followup-dock"
      style={{
        "margin-bottom": "-0.875rem",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <div
        class="pl-3 pr-2 py-2 flex items-center gap-2"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="shrink-0 text-13-medium text-text-strong cursor-default">{label()}</span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate text-13-regular text-text-base cursor-default">{preview()}</span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButton
            data-collapsed={store.collapsed ? "true" : "false"}
            icon="chevron-down"
            size="normal"
            variant="ghost"
            style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            aria-label={
              store.collapsed ? language.t("session.followupDock.expand") : language.t("session.followupDock.collapse")
            }
          />
        </div>
      </div>

      <Show when={store.collapsed}>
        <div class="h-5" aria-hidden="true" />
      </Show>

      <Show when={!store.collapsed}>
        <div class="px-3 pb-7 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar" role="list">
          <DragDropProvider onDragEnd={handleDragEnd} collisionDetector={closestCenter}>
            <DragDropSensors />
            <ConstrainDragXAxis />
            <SortableProvider ids={props.items.map((item) => item.id)}>
              <For each={props.items}>
                {(item, index) => (
                  <FollowupItem
                    item={item}
                    index={index()}
                    total={total()}
                    sending={!!props.sending}
                    reorderLabel={language.t("session.followupDock.reorder")}
                    onSend={() => props.onSend(item.id)}
                    onEdit={() => props.onEdit(item.id)}
                    onDelete={() => props.onDelete(item.id)}
                    onReorder={(toIndex) => props.onReorder(item.id, toIndex)}
                  />
                )}
              </For>
            </SortableProvider>
          </DragDropProvider>
        </div>
      </Show>
    </DockTray>
  )
}

function FollowupItem(props: {
  item: { id: string; text: string }
  index: number
  total: number
  sending: boolean
  reorderLabel: string
  onSend: () => void
  onEdit: () => void
  onDelete: () => void
  onReorder: (toIndex: number) => void
}) {
  const language = useLanguage()
  const sortable = createSortable(props.item.id)

  const move = (offset: number) => {
    if (props.sending) return
    const toIndex = props.index + offset
    if (toIndex < 0 || toIndex >= props.total) return
    props.onReorder(toIndex)
  }

  return (
    <div
      use:sortable
      role="listitem"
      tabIndex={0}
      aria-label={props.reorderLabel}
      title={props.reorderLabel}
      data-component="session-followup-item"
      class="flex items-center gap-2 min-w-0 py-1 rounded-sm transition-colors"
      classList={{ "bg-background-stronger": sortable.isActiveDraggable }}
      onKeyDown={(event) => {
        if (!event.altKey) return
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
        event.preventDefault()
        move(event.key === "ArrowUp" ? -1 : 1)
      }}
    >
      <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak cursor-grab" />
      <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">{props.item.text}</span>
      <Button size="small" variant="secondary" class="shrink-0" disabled={props.sending} onClick={props.onSend}>
        {language.t("session.followupDock.sendNow")}
      </Button>
      <Button size="small" variant="ghost" class="shrink-0" disabled={props.sending} onClick={props.onEdit}>
        {language.t("session.followupDock.edit")}
      </Button>
      <Button size="small" variant="ghost" class="shrink-0" disabled={props.sending} onClick={props.onDelete}>
        {language.t("session.followupDock.delete")}
      </Button>
    </div>
  )
}
