import { For, Show } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import type { AutoApproval } from "./tool-auto-approvals"

export function ToolAutoApproval(props: { approvals: readonly AutoApproval[]; onToggle?: () => void }) {
  const i18n = useI18n()

  return (
    <Show when={props.approvals.length > 0}>
      <details data-component="tool-auto-approval" onToggle={props.onToggle}>
        <summary data-slot="tool-auto-approval-summary">
          <span data-slot="tool-auto-approval-summary-content">
            <span data-slot="tool-auto-approval-label">{i18n.t("ui.tool.autoApproved")}</span>
            <span data-slot="tool-auto-approval-preview" aria-hidden="true">
              <bdi dir="auto">{props.approvals[0]?.action}</bdi>
              <Show when={props.approvals[0]?.resources[0]}>
                {" · "}
                <bdi dir="ltr">{props.approvals[0]?.resources[0]}</bdi>
              </Show>
            </span>
          </span>
        </summary>
        <div
          data-slot="tool-auto-approval-details"
          role="region"
          aria-label={i18n.t("ui.tool.autoApproved.details")}
          tabIndex={0}
        >
          <ul data-slot="tool-auto-approval-records">
            <For each={props.approvals}>
              {(approval) => (
                <li>
                  <bdi data-slot="tool-auto-approval-action" dir="auto">
                    {approval.action}
                  </bdi>
                  <Show when={approval.resources.length > 0}>
                    <ul data-slot="tool-auto-approval-resources">
                      <For each={approval.resources}>
                        {(resource) => (
                          <li>
                            <bdi dir="ltr">{resource}</bdi>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      </details>
    </Show>
  )
}
