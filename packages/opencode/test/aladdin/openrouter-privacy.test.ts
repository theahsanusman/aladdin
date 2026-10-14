import { expect, spyOn, test } from "bun:test"
import { generate } from "../../src/aladdin/image"

test("OpenRouter image generation sends privacy controls and preserves its image request and credentials", async () => {
  const requests: { path: string; headers: Headers; body: unknown }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() })
      return Response.json({
        id: "synthetic-image-completion",
        object: "chat.completion",
        created: 1,
        model: "test-image",
        system_fingerprint: null,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "",
              images: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }],
            },
          },
        ],
      })
    },
  })
  const transport = fetch
  // Image generation has no injectable transport; redirect only this scoped test's fixed cloud URL to localhost.
  const forwarding = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
        expect(url.href).toBe("https://openrouter.ai/api/v1/chat/completions")
        return transport(`http://127.0.0.1:${server.port}${url.pathname}`, init)
      },
      { preconnect: transport.preconnect },
    ),
  )
  try {
    expect(
      await generate({
        provider: "openrouter",
        model: "test-image",
        prompt: "privacy test",
        size: "512x512",
        apiKey: "test-key",
      }),
    ).toEqual({ image: "QUJD", mime: "image/png" })
    expect(requests).toHaveLength(1)
    expect(requests[0].body).toEqual({
      model: "test-image",
      messages: [{ role: "user", content: "privacy test" }],
      modalities: ["image", "text"],
      image_config: { size: "512x512" },
      provider: { zdr: true, data_collection: "deny" },
    })
    expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
    expect(requests[0].path).toBe("/api/v1/chat/completions")
  } finally {
    forwarding.mockRestore()
    server.stop(true)
  }
})

test("OpenRouter image rejection never falls back to a request without privacy controls", async () => {
  const bodies: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      bodies.push(await request.json())
      return Response.json(
        { error: { message: "No ZDR endpoints: private prompt and synthetic credential" } },
        { status: 404 },
      )
    },
  })
  const transport = fetch
  const forwarding = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        transport(`http://127.0.0.1:${server.port}/images`, init),
      { preconnect: transport.preconnect },
    ),
  )
  try {
    await expect(
      generate({ provider: "openrouter", model: "test-image", prompt: "privacy test", apiKey: "test-key" }),
    ).rejects.toThrow(/^openrouter returned 404$/)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ provider: { zdr: true, data_collection: "deny" } })
  } finally {
    forwarding.mockRestore()
    server.stop(true)
  }
})
