import { cpus, freemem, totalmem } from "node:os"

export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

export interface AppProcessSample {
  type: string
  cpu: { percentCPUUsage: number }
  memory: { workingSetSize: number }
}

// Polls CPU totals and returns the utilization since the previous poll. The
// first call only seeds the baseline, so callers should expect one empty read.
export function createCpuGauge(read: () => readonly CpuTimes[] = () => cpus().map((cpu) => cpu.times)) {
  let previous: { busy: number; idle: number } | undefined
  return (): number | undefined => {
    const samples = read()
    const busy = samples.reduce((sum, times) => sum + times.user + times.nice + times.sys + times.irq, 0)
    const idle = samples.reduce((sum, times) => sum + times.idle, 0)
    const baseline = previous
    previous = { busy, idle }
    if (!baseline) return
    const total = busy + idle - baseline.busy - baseline.idle
    if (total <= 0) return
    return Math.min(100, Math.max(0, Math.round(((busy - baseline.busy) / total) * 100)))
  }
}

export function systemMemory() {
  const total = totalmem()
  return { total, used: total - freemem() }
}

export function formatGib(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export function aggregateAppProcesses(samples: readonly AppProcessSample[]) {
  const cpuOf = (sample: AppProcessSample) => (Number.isFinite(sample.cpu.percentCPUUsage) ? sample.cpu.percentCPUUsage : 0)
  return {
    cpuPercent: roundOne(samples.reduce((sum, sample) => sum + cpuOf(sample), 0)),
    gpuPercent: roundOne(samples.filter((sample) => sample.type === "GPU").reduce((sum, sample) => sum + cpuOf(sample), 0)),
    memoryBytes: samples.reduce((sum, sample) => sum + sample.memory.workingSetSize * 1024, 0),
  }
}

export function parseCpuSpeedLimit(output: string) {
  const match = /CPU_Scheduler_Limit\s*:\s*(\d+)/.exec(output)
  return match ? `${match[1]}%` : undefined
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10
}
