import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "../camoufox/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"
import { StdioClientTransport } from "../camoufox/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"

const root = join(homedir(), "Library/Application Support/Agent Chrome/automation")
const endpoint = "http://127.0.0.1:9222"
assert(process.argv.length === 3 && ["--inspect", "--restart"].includes(process.argv[2]), "Choose --inspect or --restart explicitly")
const receipt = { checkedAt: new Date().toISOString(), endpoint, checks: {}, restarts: [] }
const marker = randomUUID()
const cookieName = `agent_session_check_${marker.replaceAll("-", "")}`
let client
let server
let pageId

async function connect() {
  const next = new Client({ name: "agent-chrome-session-check", version: "1" })
  await next.connect(new StdioClientTransport({ command: join(root, "chrome-devtools-mcp.command"), stderr: "pipe" }))
  client = next
  const result = await next.callTool({ name: "list_pages", arguments: {} })
  assert(!result.isError, "Official MCP must connect to Agent Chrome")
  receipt.checks.officialMcpConnected = true
}

async function call(name, arguments_ = {}) {
  const result = await client.callTool({ name, arguments: arguments_ })
  assert(!result.isError, `MCP ${name} failed`)
  const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n")
  const selected = text.match(/^(\d+): .*\[selected\]/m)
  if (selected) pageId = Number(selected[1])
  return text
}

async function evaluate(function_) {
  assert.equal(typeof pageId, "number")
  const text = await call("evaluate_script", { pageId, function: function_ })
  const body = text.match(/```(?:json)?\n([\s\S]*?)\n```/)
  assert(body, "MCP must return the test result as JSON")
  return JSON.parse(body[1])
}

async function cdp() {
  // Validate the OS port owner and fixed data flags before contacting CDP.
  execFileSync("/opt/homebrew/bin/python3", [join(root, "launcher.py"), "--check"], { stdio: "pipe" })
  const version = await (await fetch(`${endpoint}/json/version`)).json()
  assert(version.webSocketDebuggerUrl.startsWith("ws://127.0.0.1:9222/devtools/browser/"))
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener("message", event => {
    const response = JSON.parse(event.data)
    const handler = pending.get(response.id)
    if (!handler) return
    pending.delete(response.id)
    clearTimeout(handler.timer)
    if (response.error) handler.reject(new Error(`CDP ${handler.method} failed`))
    else handler.resolve(response.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id
    pending.set(next, { method, resolve, reject, timer: setTimeout(() => { pending.delete(next); reject(new Error(`CDP ${method} timed out`)) }, 15000) })
    socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  return { socket, send }
}

async function diagnostic(url, expression) {
  const connection = await cdp()
  const target = await connection.send("Target.createTarget", { url })
  try {
    const session = await connection.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = await connection.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session.sessionId)
      if (result.result.value) return result.result.value
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error("Agent Chrome diagnostic did not become available")
  } finally {
    await connection.send("Target.closeTarget", { targetId: target.targetId })
    connection.socket.close()
  }
}

async function signin() {
  // Chrome's own read-only diagnostic returns status booleans and a digest.
  // Never return email addresses, account IDs, tokens, or cookie contents.
  return diagnostic("chrome://signin-internals", `(async () => {
    const cr = await import('chrome://resources/js/cr.js');
    let info;
    for (let attempt = 0; attempt < 50; attempt++) {
      info = await cr.sendWithPromise('getSigninInfo');
      const load = info?.signin_info?.flatMap(section => section.data).find(entry => entry.label === 'TokenService Load Status')?.status;
      if (load?.includes('finished') || load?.includes('failed')) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!info?.signin_info) return null;
    const entries = info.signin_info.flatMap(section => section.data);
    const value = label => entries.find(entry => entry.label === label)?.status;
    const account = value('Account Id');
    const digest = account ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account)) : null;
    return {
      signedIn: value('Signin Status')?.startsWith('Signed In') === true,
      syncConsent: value('Signin Status') === 'Signed In, Consented for Sync',
      credentialsLoaded: value('TokenService Load Status') === 'Load credentials finished with success',
      decryptError: value('TokenService Load Status') === 'Load credentials failed with decrypt errors',
      cookiesAllowed: value('Gaia cookies state') === 'Allowed',
      authErrorAbsent: value('Auth Error') === 'None',
      refreshTokenPresent: info.accountInfo?.some(account => account.hasRefreshToken === true) === true,
      refreshTokenError: info.accountInfo?.some(account => account.hasAuthError === true) === true,
      tokenEvents: info.refreshTokenEvents?.map(event => ({ type: event.type, source: /^(TokenService|Signin|Dice|Sync|Account)/.test(event.source) ? event.source : 'Other' })) ?? [],
      accountDigest: digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('') : null
    };
  })()`)
}

function assertSignin(state) {
  assert(state.credentialsLoaded && !state.decryptError, "Saved Google credentials must decrypt successfully")
  assert(state.signedIn && state.refreshTokenPresent && state.accountDigest, "The existing Google profile sign-in must be present")
  assert(!state.syncConsent, "Chrome Sync must remain disabled")
  assert(state.cookiesAllowed, "Google cookies must be retained instead of cleared on exit")
  assert(state.authErrorAbsent && !state.refreshTokenError, "Google must not report an authentication error")
}

async function closeAgent() {
  const connection = await cdp()
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Agent Chrome did not close gracefully")), 15000)
    connection.socket.addEventListener("close", () => { clearTimeout(timer); resolve() }, { once: true })
  })
  // Chrome may close the socket before replying to Browser.close.
  connection.socket.send(JSON.stringify({ id: 0, method: "Browser.close" }))
  await closed
  await new Promise(resolve => setTimeout(resolve, 1200))
}

try {
  await connect()
  const version = await diagnostic("chrome://version", "document.querySelector('#profile_path')?.innerText && ({ profile: document.querySelector('#profile_path').innerText, command: document.querySelector('#command_line').innerText })")
  assert.equal(version.profile, join(homedir(), ".agent-chrome/Default"))
  assert(version.command.includes("--disable-sync"))
  receipt.checks.correctPrivateProfileAndSyncDisabled = true
  const initial = await signin()
  receipt.signin = Object.fromEntries(Object.entries(initial).filter(([key]) => key !== "accountDigest"))
  if (process.argv[2] === "--inspect") {
    console.log(JSON.stringify(receipt, null, 2))
  } else {
    assertSignin(initial)
    assert.throws(() => execFileSync(join(root, "chrome-devtools-mcp.command"), ["--autoConnect"], { stdio: "pipe" }))
    assert.throws(() => execFileSync(join(root, "chrome-devtools-mcp.command"), ["--browserUrl", "http://127.0.0.1:9999"], { stdio: "pipe" }))
    receipt.checks.endpointOverridesRejected = true
    server = createServer((request, response) => {
      if (request.url === "/login") response.setHeader("Set-Cookie", `${cookieName}=${marker}; HttpOnly; Max-Age=3600; SameSite=Strict; Path=/`)
      if (request.url === "/check") {
        response.setHeader("Content-Type", "application/json")
        response.end(JSON.stringify({ authorized: (request.headers.cookie ?? "").includes(`${cookieName}=${marker}`) }))
        return
      }
      if (request.url === "/cleanup") response.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; Max-Age=0; SameSite=Strict; Path=/`)
      response.end("<title>Agent Chrome Session Verification</title><p>Temporary localhost session test.</p>")
    })
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
    const site = `http://127.0.0.1:${server.address().port}`
    await call("new_page", { url: `${site}/login` })
    assert.deepEqual(await evaluate(`async () => { localStorage.setItem(${JSON.stringify(cookieName)}, ${JSON.stringify(marker)}); return await (await fetch('/check')).json() }`), { authorized: true })
    for (let restart = 1; restart <= 2; restart++) {
      await client.close()
      client = undefined
      await closeAgent()
      await connect()
      const state = await signin()
      assertSignin(state)
      assert.equal(state.accountDigest, initial.accountDigest, "The same Google account must survive restart")
      await call("new_page", { url: `${site}/session` })
      assert.deepEqual(await evaluate(`async () => ({ ...(await (await fetch('/check')).json()), storagePersisted: localStorage.getItem(${JSON.stringify(cookieName)}) === ${JSON.stringify(marker)} })`), { authorized: true, storagePersisted: true })
      receipt.restarts.push({ restart, sameGoogleAccount: true, credentialsLoaded: true, authenticatedHttpOnlyCookiePreserved: true, localStoragePreserved: true })
    }
    await evaluate(`async () => { localStorage.removeItem(${JSON.stringify(cookieName)}); await fetch('/cleanup'); return true }`)
    const pages = await call("list_pages")
    const tests = [...pages.matchAll(/^(\d+): (.+)$/gm)].filter(match => match[2].includes(site))
    await call("new_page", { url: "about:blank" })
    for (const test of tests) await call("close_page", { pageId: Number(test[1]) })
    execFileSync("/opt/homebrew/bin/python3", [join(root, "launcher.py"), "--check"], { stdio: "pipe" })
    receipt.checks.finalLoopbackOwnerValidated = true
    await writeFile(new URL("./session-verification.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n")
    console.log(JSON.stringify(receipt, null, 2))
  }
} finally {
  await client?.close()
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
