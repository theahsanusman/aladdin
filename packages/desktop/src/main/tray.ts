import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { statfs } from "node:fs/promises"
import { homedir, loadavg } from "node:os"
import { join } from "node:path"
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type ProcessMetric } from "electron"
import { nativeT } from "./native-translations"
import {
  aggregateAppProcesses,
  createCpuGauge,
  formatGib,
  parseCpuSpeedLimit,
  systemMemory,
} from "./system-metrics"

const SAMPLE_INTERVAL = 5000

let tray: Tray | undefined
let timer: ReturnType<typeof setInterval> | undefined
const gauge = createCpuGauge()
let appMetrics: ProcessMetric[] = []

interface TrayActions {
  focus: () => void
  quit: () => void
}

// The tray refreshes a light snapshot on a fixed interval so the menu can open
// with complete numbers immediately. pmset/df-style reads stay on-demand.
export function startSystemTray(actions: TrayActions) {
  tray = new Tray(trayIcon())
  appMetrics = app.getAppMetrics()
  gauge()
  tray.setToolTip(nativeT("desktop.menu.app"))
  tray.on("click", () => void showMenu(actions))
  tray.on("right-click", () => void showMenu(actions))
  timer = setInterval(() => {
    appMetrics = app.getAppMetrics()
    const cpu = gauge()
    if (!tray || cpu === undefined) return
    if (process.platform === "darwin") tray.setTitle(`${cpu}%`)
    tray.setToolTip(nativeT("desktop.tray.cpu", { value: `${cpu}%` }))
  }, SAMPLE_INTERVAL)
  timer.unref()
  app.once("will-quit", () => clearInterval(timer))
}

function trayIcon() {
  const iconPath = app.isPackaged
    ? join(app.getAppPath(), "resources/icons/32x32.png")
    : join(import.meta.dirname, "../../resources/icons/32x32.png")
  const image = existsSync(iconPath) ? nativeImage.createFromBuffer(readFileSync(iconPath)) : nativeImage.createEmpty()
  if (image.isEmpty()) return image
  const resized = image.resize({ width: 16, height: 16 })
  resized.setTemplateImage(true)
  return resized
}

async function showMenu(actions: TrayActions) {
  const current = tray
  if (!current) return
  current.popUpContextMenu(Menu.buildFromTemplate(await menuTemplate(actions)))
}

async function menuTemplate(actions: TrayActions) {
  const cpu = gauge()
  const memory = systemMemory()
  const appUsage = aggregateAppProcesses(appMetrics)
  const [disk, thermal] = await Promise.all([availableDiskSpace(), cpuSpeedLimit()])
  const metric = (label: string) => ({ label, enabled: false })
  return [
    { label: nativeT("desktop.menu.app"), enabled: false },
    { type: "separator" },
    metric(nativeT("desktop.tray.cpu", { value: cpu === undefined ? "—" : `${cpu}%` })),
    metric(nativeT("desktop.tray.memory", { used: formatGib(memory.used), total: formatGib(memory.total) })),
    metric(nativeT("desktop.tray.load", { value: loadavg()[0].toFixed(2) })),
    ...(disk ? [metric(nativeT("desktop.tray.disk", { free: formatGib(disk.free), total: formatGib(disk.total) }))] : []),
    ...(thermal ? [metric(nativeT("desktop.tray.thermal", { value: thermal }))] : []),
    { type: "separator" },
    metric(nativeT("desktop.tray.appCpu", { value: `${appUsage.cpuPercent}%` })),
    metric(nativeT("desktop.tray.appGpu", { value: `${appUsage.gpuPercent}%` })),
    metric(nativeT("desktop.tray.appMemory", { value: formatGib(appUsage.memoryBytes) })),
    { type: "separator" },
    { label: nativeT("desktop.tray.open"), click: actions.focus },
    { label: nativeT("desktop.recovery.action.quit"), click: actions.quit },
  ] satisfies MenuItemConstructorOptions[]
}

function availableDiskSpace() {
  return statfs(homedir()).then(
    (stats) => ({ free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize }),
    () => undefined,
  )
}

// The scheduler limit drops below 100% when macOS throttles the CPU for heat,
// which is the closest safe stand-in for a temperature reading in the shell.
function cpuSpeedLimit() {
  if (process.platform !== "darwin") return Promise.resolve(undefined)
  return new Promise<string | undefined>((resolve) => {
    execFile("pmset", ["-g", "therm"], { timeout: 1500, encoding: "utf8" }, (error, stdout) =>
      resolve(error ? undefined : parseCpuSpeedLimit(stdout)),
    )
  })
}
