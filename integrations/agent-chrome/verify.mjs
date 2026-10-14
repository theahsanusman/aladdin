import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { Client } from "../camoufox/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"
import { StdioClientTransport } from "../camoufox/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"

const root = join(homedir(), "Library/Application Support/Agent Chrome/automation")
const receipt = { checkedAt: new Date().toISOString(), endpoint: "http://127.0.0.1:9222", checks: {} }
const marker = randomUUID()
const observed = new Set()
const server = createServer((request, response) => {
  observed.add(request.url)
  if (request.url === "/login") response.setHeader("Set-Cookie", `agent_isolation_probe=${marker}; HttpOnly; Max-Age=3600; SameSite=Strict; Path=/`)
  if (request.url === "/check") {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ authorized: (request.headers.cookie ?? "").includes(`agent_isolation_probe=${marker}`) }))
    return
  }
  response.setHeader("Content-Type", "text/html")
  response.end(`<title>Agent Chrome Isolation Test</title><h1>Agent Chrome</h1><p>This is a temporary local browser test. Your dedicated browser is ready.</p>`)
})
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
const site = `http://127.0.0.1:${server.address().port}`
let client
let pageId

async function connect() {
  const next = new Client({ name: "agent-chrome-isolation-check", version: "1" })
  await next.connect(new StdioClientTransport({ command: join(root, "chrome-devtools-mcp.command"), stderr: "pipe" }))
  return next
}

async function call(name, arguments_ = {}) {
  const result = await client.callTool({ name, arguments: arguments_ })
  const text = result.content.filter(item => item.type === "text").map(item => item.text).join("\n")
  assert(!result.isError, `${name}: ${text}`)
  const selected = text.match(/^(\d+): .*\[selected\]/m)
  if (selected) pageId = Number(selected[1])
  return text
}

async function evaluate(function_) {
  assert.equal(typeof pageId, "number", "MCP must identify the selected Agent Chrome page")
  const text = await call("evaluate_script", { pageId, function: function_ })
  const body = text.match(/```(?:json)?\n([\s\S]*?)\n```/)
  assert(body, `Unexpected script response: ${text}`)
  return JSON.parse(body[1])
}

async function closeAgent() {
  execFileSync("/opt/homebrew/bin/python3", [join(root, "launcher.py"), "--check"], { stdio: "pipe" })
  const version = await (await fetch("http://127.0.0.1:9222/json/version")).json()
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl)
    const timer = setTimeout(() => { socket.close(); reject(new Error("Agent Chrome did not close")) }, 10000)
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })))
    socket.addEventListener("close", () => { clearTimeout(timer); resolve() })
    socket.addEventListener("error", reject)
  })
}

async function inspectInternal(url, expression) {
  // The official MCP deliberately rejects chrome:// navigation. Use that same verified
  // Agent Chrome CDP endpoint for the browser's own diagnostic pages, then close them.
  execFileSync("/opt/homebrew/bin/python3", [join(root, "launcher.py"), "--check"], { stdio: "pipe" })
  const version = await (await fetch("http://127.0.0.1:9222/json/version")).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener("message", event => {
    const response = JSON.parse(event.data)
    const handler = pending.get(response.id)
    if (!handler) return
    pending.delete(response.id)
    clearTimeout(handler.timer)
    if (response.error) handler.reject(new Error(response.error.message))
    else handler.resolve(response.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id
    pending.set(next, { resolve, reject, timer: setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 10000) })
    socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const target = await send("Target.createTarget", { url })
  try {
    const session = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
    for (let attempt = 0; attempt < 25; attempt++) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true }, session.sessionId)
      if (result.result.value) return result.result.value
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error(`Diagnostic page did not render: ${url}`)
  } finally {
    await send("Target.closeTarget", { targetId: target.targetId })
    socket.close()
  }
}

try {
  client = await connect()
  const tools = await client.listTools()
  assert(tools.tools.some(tool => tool.name === "list_pages"))
  assert(tools.tools.some(tool => tool.name === "new_page"))
  receipt.checks.officialMcpConnectedWithoutSharingPrompt = true
  assert.throws(() => execFileSync(join(root, "chrome-devtools-mcp.command"), ["--autoConnect"], { stdio: "pipe" }), /accepts no custom arguments/)
  receipt.checks.wrapperRejectsEndpointOverridesAndAutoConnect = true
  await call("new_page", { url: `${site}/login` })
  assert.deepEqual(await evaluate(`async () => { localStorage.setItem("agent-isolation-probe", ${JSON.stringify(marker)}); return await (await fetch("/check")).json() }`), { authorized: true })
  receipt.checks.syntheticSessionEstablished = true
  const version = await inspectInternal("chrome://version", "document.querySelector('#profile_path')?.innerText && ({ profile: document.querySelector('#profile_path').innerText, command: document.querySelector('#command_line').innerText })")
  assert.equal(version.profile, join(homedir(), ".agent-chrome/Default"))
  assert(version.command.includes("--disable-sync"))
  assert(version.command.includes("--remote-debugging-address=127.0.0.1"))
  receipt.checks.renderedProfileIsAgentDirectory = true
  receipt.checks.syncDisabledByBrowserFlag = true
  // --disable-sync prevents creation of the Sync service, so sync-internals has no
  // transport-state rows. Verify the active browser's command line above, rather than
  // interpreting that empty diagnostic page as an enabled/disabled transport.
  receipt.checks.syncVerification = "active browser command line contains --disable-sync"

  // The user requested these isolation probes. Launch only harmless, known test URLs through
  // Chrome's OS command line, without connecting to or reading personal browser state.
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  const agentChrome = join(homedir(), "Applications/Agent Chrome.app/Contents/MacOS/Google Chrome")
  const personal = join(homedir(), "Library/Application Support/Google/Chrome")
  for (const [mode, flags] of [["normal", []], ["incognito", ["--incognito"]], ["guest-profile", ["--guest"]]]) {
    execFileSync("/usr/bin/open", ["-na", "Google Chrome", "--args", `--user-data-dir=${personal}`, "--no-first-run", "--no-default-browser-check", ...flags, "--new-window", `${site}/personal-${mode}`])
    for (let attempt = 0; attempt < 50 && !observed.has(`/personal-${mode}`); attempt++) await new Promise(resolve => setTimeout(resolve, 200))
    assert(observed.has(`/personal-${mode}`), `Personal ${mode} test window did not open`)
    const pages = await call("list_pages")
    assert(!pages.includes(`/personal-${mode}`), `Personal ${mode} appeared in MCP`)
    receipt.checks[`${mode}OutsideMcp`] = true
  }
  const processRows = execFileSync("/bin/ps", ["-ww", "-axo", "pid=,args="], { encoding: "utf8" }).split("\n")
  const browsers = processRows.filter(row => row.includes(`${chrome} --`) && !row.includes("--type="))
  assert(browsers.some(row => row.includes(`--user-data-dir=${personal}`) && !row.includes("--remote-debugging")))
  assert(processRows.some(row => row.includes(`${agentChrome} --`) && !row.includes("--type=") && row.includes(`--user-data-dir=${join(homedir(), ".agent-chrome")}`) && row.includes("--remote-debugging-port=9222")))
  receipt.checks.simultaneousIndependentChromeProcesses = true
  receipt.checks.personalChromeHasNoRemoteDebuggingFlags = true
  receipt.checks.differentEntireUserDataDirectories = true
  await client.close()
  client = undefined
  await closeAgent()
  await new Promise(resolve => setTimeout(resolve, 1200))
  let unexpectedRequests = 0
  const unexpected = createServer((_request, response) => { unexpectedRequests++; response.writeHead(503).end() })
  await new Promise((resolve, reject) => { unexpected.once("error", reject); unexpected.listen(9222, "127.0.0.1", resolve) })
  try {
    assert.throws(() => execFileSync(join(root, "chrome-devtools-mcp.command"), [], { stdio: "pipe", timeout: 5000 }), /not owned by standard Google Chrome/)
    assert.equal(unexpectedRequests, 0)
    receipt.checks.unexpectedPortOwnerRejectedBeforeAnyBrowserRequest = true
  } finally {
    await new Promise(resolve => unexpected.close(resolve))
  }
  // Reconnecting the configured wrapper itself must launch the closed dedicated browser.
  client = await connect()
  receipt.checks.agentCanCloseAndAutomaticallyReopen = true
  await call("new_page", { url: `${site}/session` })
  assert.deepEqual(await evaluate(`async () => ({ ...(await (await fetch("/check")).json()), storagePersisted: localStorage.getItem("agent-isolation-probe") === ${JSON.stringify(marker)} })`), { authorized: true, storagePersisted: true })
  receipt.checks.httpOnlyPersistentCookieSurvivesRestart = true
  receipt.checks.localStorageSurvivesRestart = true
  await evaluate('async () => { localStorage.removeItem("agent-isolation-probe"); return true }')
  // Remove only our test tabs; never close or inspect personal browser windows.
  const pages = await call("list_pages")
  const tests = [...pages.matchAll(/^(\d+): (.+)$/gm)].filter(match => match[2].includes(site) || /^chrome:\/\/(?:version|sync-internals)/.test(match[2]))
  await call("new_page", { url: "about:blank" })
  for (const test of tests) await call("close_page", { pageId: Number(test[1]) })
  execFileSync("/opt/homebrew/bin/python3", [join(root, "launcher.py"), "--check"], { stdio: "pipe" })
  receipt.checks.finalLoopbackListenerAndOwnerValidated = true
  receipt.checks.businessAccountSignIn = "not attempted; human signs into secondary accounts manually"
  await writeFile(new URL("./verification.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n")
  console.log(JSON.stringify(receipt, null, 2))
} finally {
  await client?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
