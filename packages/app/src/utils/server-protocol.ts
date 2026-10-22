import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"
import { retry } from "@opencode-ai/core/util/retry"

export type ServerProtocol = "v1" | "v2"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  return retry(
    async () => {
      let failure: unknown
      const failed = (error: unknown) => {
        failure = error
        return undefined
      }
      const legacy = await probe(server, fetch, "/global/health").catch(failed)
      if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

      const current = await probe(server, fetch, "/api/health").catch(failed)
      if (current && "pid" in current && typeof current.pid === "number") return "v2"
      if (current && "healthy" in current && current.healthy === true) return "v1"
      // A failed network probe cannot establish the API generation. Retrying
      // discovery avoids retaining the wrong client for the entire browser tab.
      if (failure !== undefined) throw failure
      return "v2"
    },
    { delay: 250, retryIf: () => true },
  )
}
