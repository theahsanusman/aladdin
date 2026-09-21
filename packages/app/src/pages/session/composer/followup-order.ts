export function moveFollowup<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items]
  const next = [...items]
  const moved = next.splice(from, 1)[0]
  if (moved === undefined) return [...items]
  next.splice(to, 0, moved)
  return next
}

export function followupDragIndex(
  items: readonly { id: string }[],
  source: string,
  target: string,
): number | undefined {
  const from = items.findIndex((item) => item.id === source)
  const to = items.findIndex((item) => item.id === target)
  if (from === -1 || to === -1 || from === to) return undefined
  return to
}
