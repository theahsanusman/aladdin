import { checksum } from "@opencode-ai/core/util/encode"
import DOMPurify from "dompurify"
import { parseMarkdown } from "./markdown-worker"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const max = 200
const maxBytes = 16 * 1024 * 1024
const cache = new Map<string, { value: MarkdownCacheEntry; bytes: number }>()
let totalBytes = 0
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

export function sanitizeMarkdown(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export function getCachedMarkdown(key: string) {
  return cache.get(key)?.value
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  totalBytes -= cache.get(key)?.bytes ?? 0
  cache.delete(key)
  // Count both source and expanded HTML conservatively as UTF-16. One large
  // tool reply must not retain hundreds of megabytes in the optional render cache.
  const bytes = (key.length + value.raw.length + value.hash.length + value.html.length) * 2
  if (bytes > maxBytes) return
  cache.set(key, { value, bytes })
  totalBytes += bytes

  while (cache.size > max || totalBytes > maxBytes) {
    const first = cache.keys().next().value
    if (first === undefined) return
    totalBytes -= cache.get(first)!.bytes
    cache.delete(first)
  }
}

export async function preloadMarkdown(text: string, cacheKey: string) {
  const key = `${cacheKey}:0:full`
  const cached = getCachedMarkdown(key)
  if (cached?.raw === text) {
    touchCachedMarkdown(key, cached)
    return
  }
  const hash = checksum(text)
  if (!hash) return
  touchCachedMarkdown(key, {
    raw: text,
    hash,
    html: sanitizeMarkdown(await parseMarkdown(text)),
  })
}
