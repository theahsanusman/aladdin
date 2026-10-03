import { OpenCode } from "../../../client/src/index"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

// The main app deliberately retains its vendored compatibility client. Workers
// consume the generated current client without replacing that existing surface.
export function createWorkerClient(server: ServerConnection.HttpBase, fetch?: typeof globalThis.fetch) {
  return OpenCode.make({
    baseUrl: server.url,
    fetch,
    headers: server.password ? { Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}` } : undefined,
  }).tasks
}
