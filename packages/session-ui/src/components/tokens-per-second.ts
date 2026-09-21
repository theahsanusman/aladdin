// Average generation speed for one assistant turn. `tokens` counts visible output plus reasoning,
// because a provider generates both over the same elapsed window.
export function tokensPerSecond(input: { tokens: number; created: number; completed?: number }) {
  if (input.tokens <= 0 || input.completed === undefined) return
  const elapsed = input.completed - input.created
  if (elapsed <= 0) return
  return input.tokens / (elapsed / 1_000)
}
