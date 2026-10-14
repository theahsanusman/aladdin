import { isIP } from "node:net"
import http from "node:http"
import https from "node:https"

export class LocalMediaError extends Error {}

export function localMediaEndpoint(value: string) {
  const url = URL.parse(value)
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return
  if (url.username || url.password || /^https?:\/\/[^/?#]*@/i.test(value.trim()) || url.search || url.hash) return
  if (
    url.hostname !== "localhost" &&
    url.hostname !== "[::1]" &&
    !(isIP(url.hostname) === 4 && url.hostname.startsWith("127."))
  )
    return
  // Pin localhost instead of trusting DNS/hosts overrides for a local-only service.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1"
  return url
}

export async function fetchLocalMedia(endpoint: string, pathname: string, init?: RequestInit) {
  const url = localMediaEndpoint(endpoint)
  if (!url)
    throw new LocalMediaError("Local media requires a loopback HTTP(S) URL without credentials, query, or fragment")
  url.pathname = url.pathname.replace(/\/+$/, "") + pathname
  // Bun 1.4.2 still honors proxy environment variables with proxy:false. A direct,
  // unpooled HTTP request avoids that process-global proxy and never follows redirects.
  const multipart = init?.body instanceof FormData ? await new Response(init.body).blob() : undefined
  const body = new Request(url, multipart ? { ...init, body: multipart } : init)
  if (multipart) body.headers.set("content-type", multipart.type)
  const data = body.body ? Buffer.from(await body.arrayBuffer()) : undefined
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: body.method,
        headers: Object.fromEntries(body.headers),
        signal: body.signal,
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 500
        if (status >= 300 && status < 400) {
          response.destroy()
          reject(new Error("Local media redirects are not allowed"))
          return
        }
        const headers = new Headers(
          Object.entries(response.headers).flatMap(([name, value]) =>
            typeof value === "string" ? [[name, value]] : (value?.map((value) => [name, value]) ?? []),
          ),
        )
        if (status >= 400 || body.method === "HEAD" || status === 204 || status === 205) {
          response.destroy()
          resolve(new Response(null, { status, headers }))
          return
        }
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("error", reject)
        response.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status,
              headers,
            }),
          ),
        )
      },
    )
    request.on("error", reject)
    request.end(data)
  })
}
