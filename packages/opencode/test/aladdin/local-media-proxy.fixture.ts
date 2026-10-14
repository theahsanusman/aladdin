import { fetchLocalMedia } from "../../src/aladdin/local-media"

const proxied: string[] = []
const direct: string[] = []
const proxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    proxied.push(await request.text())
    return new Response("proxy response")
  },
})
const origin = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    direct.push(await request.text())
    return new Response("local response")
  },
})
process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.port}`
process.env.http_proxy = process.env.HTTP_PROXY
process.env.HTTPS_PROXY = process.env.HTTP_PROXY
process.env.https_proxy = process.env.HTTP_PROXY
process.env.NO_PROXY = ""
process.env.no_proxy = ""
try {
  // A proxied baseline makes the direct-request privacy check non-vacuous.
  const baseline = await fetch(`http://127.0.0.1:${origin.port}/baseline`, {
    method: "POST",
    body: "synthetic baseline",
  })
  const response = await fetchLocalMedia(`http://127.0.0.1:${origin.port}`, "/media", {
    method: "POST",
    body: "private synthetic media",
  })
  console.log(JSON.stringify({ baseline: await baseline.text(), response: await response.text(), proxied, direct }))
} finally {
  proxy.stop(true)
  origin.stop(true)
}
