import { expect, spyOn, test } from "bun:test"
import { generate } from "../../src/aladdin/image"

test("OpenAI images use the documented schema without an unsupported store field", async () => {
  const requests: { path: string; headers: Headers; body: unknown }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() })
      return Response.json({ created: 1, data: [{ b64_json: "QUJD" }], output_format: "png" })
    },
  })
  const transport = fetch
  // Cloud URLs are fixed in production. Forward only this URL to a real loopback server, never to a paid provider.
  const forwarding = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
        expect(url.href).toBe("https://api.openai.com/v1/images/generations")
        return transport(`http://127.0.0.1:${server.port}${url.pathname}`, init)
      },
      { preconnect: transport.preconnect },
    ),
  )
  try {
    expect(
      await generate({
        provider: "openai",
        model: "gpt-image-1",
        prompt: "synthetic prompt",
        size: "1024x1024",
        apiKey: "synthetic-key",
      }),
    ).toEqual({ image: "QUJD", mime: "image/png" })
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe("/v1/images/generations")
    expect(requests[0].body).toEqual({
      model: "gpt-image-1",
      prompt: "synthetic prompt",
      size: "1024x1024",
      output_format: "png",
    })
    expect(requests[0].headers.get("authorization")).toBe("Bearer synthetic-key")
  } finally {
    forwarding.mockRestore()
    server.stop(true)
  }
})
