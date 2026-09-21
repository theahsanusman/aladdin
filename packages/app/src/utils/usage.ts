import type { Usage } from "@opencode-ai/schema/usage"

export type UsageSummaryRow = Usage.SummaryRow

export function createUsageApi(request: (path: string, init?: RequestInit) => Promise<Response>) {
  async function summary(range: { from?: number; to?: number } = {}) {
    const params = new URLSearchParams()
    if (range.from !== undefined) params.set("from", String(range.from))
    if (range.to !== undefined) params.set("to", String(range.to))
    const query = params.toString()
    const response = await request(`/usage/summary${query ? `?${query}` : ""}`)
    if (!response.ok) throw new Error(`Usage request failed (${response.status})`)
    return (await response.json()) as ReadonlyArray<UsageSummaryRow>
  }

  return { summary }
}
