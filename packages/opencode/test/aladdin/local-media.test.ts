import { describe, expect, test } from "bun:test"
import { fetchLocalMedia, localMediaEndpoint } from "../../src/aladdin/local-media"

describe("local media endpoints", () => {
  test.each([
    ["http://127.0.0.1:43121", "http://127.0.0.1:43121/"],
    ["http://127.0.0.1:43122", "http://127.0.0.1:43122/"],
    ["http://127.0.0.1:7860", "http://127.0.0.1:7860/"],
    ["http://127.0.0.2:1234/base/", "http://127.0.0.2:1234/base/"],
    ["http://localhost:1234", "http://127.0.0.1:1234/"],
    ["https://LOCALHOST:1234/base", "https://127.0.0.1:1234/base"],
    ["http://[::1]:1234", "http://[::1]:1234/"],
    ["https://[0:0:0:0:0:0:0:1]:1234", "https://[::1]:1234/"],
  ])("accepts literal loopback configuration %s", (value, expected) => {
    expect(localMediaEndpoint(value)?.href).toBe(expected)
  })

  test.each([
    "",
    "not a URL",
    "//localhost:43121",
    "http://0.0.0.0:43121",
    "http://192.168.1.1:43121",
    "https://example.com",
    "https://localhost.example.com",
    "http://127.0.0.1.example.com",
    "http://[::2]",
    "http://[::ffff:192.168.1.1]",
    "http://[::ffff:127.0.0.1]",
    "file:///tmp/audio",
    "ftp://127.0.0.1",
    "ws://localhost",
    "http://user:synthetic-key@localhost",
    "http://localhost@127.0.0.1",
    "http://@localhost",
    "http://localhost?key=synthetic-key",
    "http://localhost#synthetic-key",
  ])("rejects non-local or credential-bearing configuration %s", (value) => {
    expect(localMediaEndpoint(value)).toBeUndefined()
  })

  test.each(["127.0.0.1", "localhost", "[::1]"])(
    "sends synthetic media only to %s and preserves a base path",
    async (hostname) => {
      const requests: { path: string; body: string }[] = []
      const server = Bun.serve({
        hostname: hostname === "[::1]" ? "::1" : "127.0.0.1",
        port: 0,
        async fetch(request) {
          requests.push({ path: new URL(request.url).pathname, body: await request.text() })
          return new Response("synthetic response")
        },
      })
      try {
        const response = await fetchLocalMedia(`http://${hostname}:${server.port}/base///`, "/media", {
          method: "POST",
          body: "synthetic media",
        })
        expect(await response.text()).toBe("synthetic response")
        expect(requests).toEqual([{ path: "/base/media", body: "synthetic media" }])
      } finally {
        server.stop(true)
      }
    },
  )

  test("rejects credential-bearing loopback URLs before sending media and keeps credentials out of the error", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push(await request.text())
        return new Response("unexpected")
      },
    })
    try {
      await expect(
        fetchLocalMedia(`http://user:synthetic-key@127.0.0.1:${server.port}`, "/media", {
          method: "POST",
          body: "private synthetic media",
        }),
      ).rejects.toThrow(/^Local media requires a loopback HTTP\(S\) URL without credentials, query, or fragment$/)
      expect(requests).toEqual([])
    } finally {
      server.stop(true)
    }
  })

  test("does not send local media through an inherited HTTP proxy", async () => {
    // Bun caches proxy state beyond restoring process.env. Isolate this real transport probe so later HTTP tests stay clean.
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/local-media-proxy.fixture.ts`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe("")
    expect(status).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      baseline: "proxy response",
      response: "local response",
      proxied: ["synthetic baseline"],
      direct: ["private synthetic media"],
    })
  })
})
