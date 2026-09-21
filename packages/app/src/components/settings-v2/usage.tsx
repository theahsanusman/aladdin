import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { createUsageApi, type UsageSummaryRow } from "@/utils/usage"

const ranges = ["24h", "7d", "30d", "all"] as const
type RangeID = (typeof ranges)[number]

const rangeHours: Record<Exclude<RangeID, "all">, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }

export const formatTokens = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(Math.round(value))
}

export const formatCost = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  if (value < 0.01) return "<$0.01"
  return `$${value.toFixed(2)}`
}

const formatExactCost = (value: number) => (value > 0 && value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`)

const emptyTotals = () => ({ cost: 0, responses: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })

function totalTokens(row: UsageSummaryRow) {
  return row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cache.read + row.tokens.cache.write
}

export const SettingsUsageV2 = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const [range, setRange] = createSignal<RangeID>("7d")

  const [rows] = createResource(range, async (value) => {
    const to = Date.now()
    const from = value === "all" ? undefined : to - rangeHours[value] * 60 * 60 * 1000
    return createUsageApi(server().request).summary({ from, to })
  })

  const entries = createMemo(() => rows() ?? [])

  const totals = createMemo(() =>
    entries().reduce(
      (acc, row) => ({
        cost: acc.cost + row.cost,
        responses: acc.responses + row.messages,
        input: acc.input + row.tokens.input,
        output: acc.output + row.tokens.output,
        reasoning: acc.reasoning + row.tokens.reasoning,
        cacheRead: acc.cacheRead + row.tokens.cache.read,
        cacheWrite: acc.cacheWrite + row.tokens.cache.write,
      }),
      emptyTotals(),
    ),
  )

  const tokens = createMemo(() => {
    const value = totals()
    return value.input + value.output + value.reasoning + value.cacheRead + value.cacheWrite
  })

  const cacheShare = createMemo(() => {
    const value = totals()
    const cacheable = value.input + value.cacheRead
    if (cacheable <= 0) return undefined
    return value.cacheRead / cacheable
  })

  const models = createMemo(() => {
    const grouped = new Map<string, { providerID: string; modelID: string; responses: number; cost: number; tokens: number }>()
    for (const row of entries()) {
      const key = `${row.providerID}\u0000${row.modelID}`
      const current = grouped.get(key) ?? { providerID: row.providerID, modelID: row.modelID, responses: 0, cost: 0, tokens: 0 }
      current.responses += row.messages
      current.cost += row.cost
      current.tokens += totalTokens(row)
      grouped.set(key, current)
    }
    return [...grouped.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || b.responses - a.responses)
  })

  const days = createMemo(() => {
    const grouped = new Map<string, { date: string; cost: number; tokens: number }>()
    for (const row of entries()) {
      const current = grouped.get(row.date) ?? { date: row.date, cost: 0, tokens: 0 }
      current.cost += row.cost
      current.tokens += totalTokens(row)
      grouped.set(row.date, current)
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31)
  })

  const chartMax = createMemo(() => {
    const maxCost = Math.max(0, ...days().map((day) => day.cost))
    if (maxCost > 0) return maxCost
    return Math.max(1, ...days().map((day) => day.tokens))
  })

  const chartByCost = createMemo(() => days().some((day) => day.cost > 0))

  const providerCount = createMemo(() => new Set(models().map((model) => model.providerID)).size)

  const label = (value: string) => language.t(`settings.usage.range.${value}`)

  const summary = createMemo(() =>
    models().map((model) => ({
      ...model,
      tokens: formatTokens(model.tokens),
    })),
  )

  return (
    <div data-component="usage-panel">
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.usage.section.overview")}</h3>
        <div data-component="usage-ranges" role="tablist" aria-label={language.t("settings.usage.range.aria")}>
          <For each={ranges}>
            {(item) => (
              <button
                type="button"
                role="tab"
                data-component="usage-range"
                data-active={range() === item}
                aria-selected={range() === item}
                onClick={() => setRange(item)}
              >
                {label(item)}
              </button>
            )}
          </For>
        </div>
        <Show
          when={!rows.error}
          fallback={<div data-component="usage-empty">{language.t("settings.usage.error")}</div>}
        >
          <Show when={!rows.loading} fallback={<div data-component="usage-empty">{language.t("settings.usage.loading")}</div>}>
            <Show
              when={entries().length > 0}
              fallback={<div data-component="usage-empty">{language.t("settings.usage.empty")}</div>}
            >
              <div data-component="usage-cards">
                <div data-component="usage-card">
                  <span data-slot="usage-card-label">{language.t("settings.usage.card.cost")}</span>
                  <span data-slot="usage-card-value" title={formatExactCost(totals().cost)}>
                    {formatCost(totals().cost)}
                  </span>
                  <span data-slot="usage-card-hint">
                    {language.t("settings.usage.card.costHint", { responses: String(totals().responses) })}
                  </span>
                </div>
                <div data-component="usage-card">
                  <span data-slot="usage-card-label">{language.t("settings.usage.card.tokens")}</span>
                  <span data-slot="usage-card-value">{formatTokens(tokens())}</span>
                  <span data-slot="usage-card-hint">
                    {language.t("settings.usage.card.tokensHint", {
                      input: formatTokens(totals().input),
                      output: formatTokens(totals().output),
                      cache: formatTokens(totals().cacheRead),
                    })}
                  </span>
                </div>
                <div data-component="usage-card">
                  <span data-slot="usage-card-label">{language.t("settings.usage.card.responses")}</span>
                  <span data-slot="usage-card-value">{totals().responses}</span>
                  <span data-slot="usage-card-hint">
                    {language.t("settings.usage.card.responsesHint", { count: String(providerCount()) })}
                  </span>
                </div>
                <div data-component="usage-card">
                  <span data-slot="usage-card-label">{language.t("settings.usage.card.cache")}</span>
                  <span data-slot="usage-card-value">
                    <Show when={cacheShare()} fallback="–">
                      {(share) => `${Math.round(share() * 100)}%`}
                    </Show>
                  </span>
                  <span data-slot="usage-card-hint">
                    {language.t("settings.usage.card.cacheHint", {
                      read: formatTokens(totals().cacheRead),
                      write: formatTokens(totals().cacheWrite),
                    })}
                  </span>
                </div>
              </div>

              <div data-component="usage-chart" aria-hidden="true">
                <For each={days()}>
                  {(day) => (
                    <div
                      data-component={chartByCost() ? "usage-bar" : "usage-bar-empty"}
                      title={language.t("settings.usage.chart.bar", {
                        date: day.date,
                        cost: formatExactCost(day.cost),
                        tokens: formatTokens(day.tokens),
                      })}
                      style={{
                        height: `${Math.max(2, Math.round(((chartByCost() ? day.cost : day.tokens) / chartMax()) * 100))}%`,
                      }}
                    />
                  )}
                </For>
              </div>
              <div data-slot="usage-chart-caption">
                <span>{days()[0]?.date}</span>
                <span>{language.t(chartByCost() ? "settings.usage.chart.cost" : "settings.usage.chart.tokens")}</span>
                <Show when={days().length > 1}>
                  <span>{days().at(-1)?.date}</span>
                </Show>
              </div>

              <div data-component="usage-models">
                <div data-component="usage-model-row" data-header="true">
                  <span data-slot="usage-model-name">{language.t("settings.usage.models.name")}</span>
                  <span data-slot="usage-model-metric">{language.t("settings.usage.models.responses")}</span>
                  <span data-slot="usage-model-metric">{language.t("settings.usage.models.tokens")}</span>
                  <span data-slot="usage-model-metric">{language.t("settings.usage.models.cost")}</span>
                </div>
                <For each={summary()}>
                  {(model) => (
                    <div data-component="usage-model-row" title={`${model.providerID}/${model.modelID}`}>
                      <span data-slot="usage-model-name">
                        <span data-slot="usage-model-provider">{model.providerID}</span>
                        <span data-slot="usage-model-id">{model.modelID}</span>
                      </span>
                      <span data-slot="usage-model-metric">{model.responses}</span>
                      <span data-slot="usage-model-metric">{model.tokens}</span>
                      <span data-slot="usage-model-cost" title={formatExactCost(model.cost)}>
                        {formatCost(model.cost)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
