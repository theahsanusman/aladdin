import { describe, expect, test } from "bun:test"
import { generate } from "../../src/aladdin/image"

async function withDrawThings(
  handler: (request: Request) => Response | Promise<Response>,
  run: (input: { url: string }) => Promise<void>,
) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  const previous = process.env.ALADDIN_DRAW_THINGS_URL
  process.env.ALADDIN_DRAW_THINGS_URL = `http://127.0.0.1:${server.port}`
  try {
    await run({ url: `http://127.0.0.1:${server.port}` })
  } finally {
    server.stop(true)
    if (previous === undefined) delete process.env.ALADDIN_DRAW_THINGS_URL
    else process.env.ALADDIN_DRAW_THINGS_URL = previous
  }
}

describe("Aladdin image generation", () => {
  test("generates through the Draw Things HTTP API", async () => {
    const requests: { path: string; body: unknown }[] = []
    await withDrawThings(
      async (request) => {
        requests.push({
          path: new URL(request.url).pathname,
          body: await request.json().catch(() => undefined),
        })
        if (new URL(request.url).pathname !== "/sdapi/v1/txt2img") return new Response("missing", { status: 404 })
        return Response.json({ images: ["data:image/png;base64,QUJD"] })
      },
      async () => {
        const result = await generate({
          provider: "draw-things",
          model: "sd_v1.5_f16.ckpt",
          prompt: "a red panda reading a book",
          size: "512x768",
        })
        expect(result).toEqual({ image: "QUJD", mime: "image/png" })
        expect(requests).toEqual([
          {
            path: "/sdapi/v1/txt2img",
            body: {
              prompt: "a red panda reading a book",
              model: "sd_v1.5_f16.ckpt",
              width: 512,
              height: 768,
            },
          },
        ])
      },
    )
  })

  test("omits size when the requested size is not a pixel pair", async () => {
    const bodies: unknown[] = []
    await withDrawThings(
      async (request) => {
        bodies.push(await request.json().catch(() => undefined))
        return Response.json({ images: ["cmF3"] })
      },
      async () => {
        const result = await generate({ provider: "draw-things", model: "m", prompt: "p", size: "auto" })
        expect(result).toEqual({ image: "cmF3", mime: "image/png" })
        expect(bodies).toEqual([{ prompt: "p", model: "m" }])
      },
    )
  })

  test("reports the Draw Things status without reflecting private failure data", async () => {
    await withDrawThings(
      () => new Response("private prompt and synthetic credential", { status: 500 }),
      async () => {
        await expect(generate({ provider: "draw-things", model: "m", prompt: "p" })).rejects.toThrow(
          /^Draw Things returned 500$/,
        )
      },
    )
  })

  test("rejects a non-loopback Draw Things override before sending the prompt", async () => {
    const requests: string[] = []
    await withDrawThings(
      async (request) => {
        requests.push(await request.text())
        return Response.json({ images: ["QUJD"] })
      },
      async (server) => {
        process.env.ALADDIN_DRAW_THINGS_URL = server.url.replace("127.0.0.1", "0.0.0.0")
        await expect(generate({ provider: "draw-things", model: "m", prompt: "private prompt" })).rejects.toThrow(
          /loopback HTTP\(S\)/,
        )
        expect(requests).toEqual([])
      },
    )
  })

  test.each([307, 308])("never follows a Draw Things %d redirect with the image prompt", async (status) => {
    const redirected: string[] = []
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        redirected.push(await request.text())
        return Response.json({ images: ["QUJD"] })
      },
    })
    try {
      await withDrawThings(
        () => new Response(null, { status, headers: { location: `http://127.0.0.1:${target.port}/capture` } }),
        async () => {
          await expect(generate({ provider: "draw-things", model: "m", prompt: "private prompt" })).rejects.toThrow(
            /Draw Things image request failed/,
          )
          expect(redirected).toEqual([])
        },
      )
    } finally {
      target.stop(true)
    }
  })

  test("does not expose malformed Draw Things response data in parse errors", async () => {
    await withDrawThings(
      () => new Response("private response text", { headers: { "content-type": "application/json" } }),
      async () => {
        await expect(generate({ provider: "draw-things", model: "m", prompt: "p" })).rejects.toThrow(
          /^Draw Things returned invalid JSON$/,
        )
      },
    )
  })

  test("reports a Draw Things response with no image", async () => {
    await withDrawThings(
      () => Response.json({ images: [] }),
      async () => {
        await expect(generate({ provider: "draw-things", model: "m", prompt: "p" })).rejects.toThrow(
          /Draw Things returned no image/,
        )
      },
    )
  })

  test("requires cloud credentials before calling a cloud provider", async () => {
    await expect(generate({ provider: "openai", model: "gpt-image-1", prompt: "p" })).rejects.toThrow(
      /No openai API key is configured/,
    )
    await expect(generate({ provider: "gemini", model: "gemini-2.5-flash-image", prompt: "p" })).rejects.toThrow(
      /No gemini API key is configured/,
    )
  })

  test("cancels before sending Draw Things media without exposing a private abort reason", async () => {
    const requests: string[] = []
    await withDrawThings(
      async (request) => {
        requests.push(await request.text())
        return Response.json({ images: ["QUJD"] })
      },
      async () => {
        await expect(
          generate({
            provider: "draw-things",
            model: "m",
            prompt: "synthetic prompt",
            signal: AbortSignal.abort(new Error("synthetic private abort reason")),
          }),
        ).rejects.toThrow(/^Draw Things image request failed$/)
        expect(requests).toEqual([])
      },
    )
  })

  test("cancels a stalled response body instead of leaving a local request pending", async () => {
    await withDrawThings(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"images":['))
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      async () => {
        await expect(
          generate({
            provider: "draw-things",
            model: "m",
            prompt: "synthetic prompt",
            signal: AbortSignal.timeout(50),
          }),
        ).rejects.toThrow(/^Draw Things image request failed$/)
      },
    )
  })
})
