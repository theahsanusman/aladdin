import { describe, expect, test } from "bun:test"
import { aggregateAppProcesses, createCpuGauge, formatGib, parseCpuSpeedLimit, type CpuTimes } from "./system-metrics"

function feed(idle: number, busy: number): CpuTimes[] {
  return [{ user: busy, nice: 0, sys: 0, idle, irq: 0 }]
}

describe("system metrics", () => {
  test("cpu gauge reports utilization between consecutive samples", () => {
    const feeds = [feed(100, 0), feed(150, 50), feed(150, 250)]
    let index = 0
    const gauge = createCpuGauge(() => feeds[Math.min(index++, feeds.length - 1)])
    expect(gauge()).toBeUndefined()
    expect(gauge()).toBe(50)
    expect(gauge()).toBe(100)
  })

  test("cpu gauge never returns negative or over-limit percentages", () => {
    const feeds = [feed(100, 100), feed(400, 100)]
    let index = 0
    const gauge = createCpuGauge(() => feeds[Math.min(index++, feeds.length - 1)])
    gauge()
    expect(gauge()).toBe(0)
  })

  test("cpu gauge stays quiet when the system reports no deltas", () => {
    const gauge = createCpuGauge(() => [])
    expect(gauge()).toBeUndefined()
    expect(gauge()).toBeUndefined()
  })

  test("formats byte counts as GB with one decimal", () => {
    expect(formatGib(15 * 1024 ** 3)).toBe("15.0 GB")
    expect(formatGib(1024 ** 3 / 2)).toBe("0.5 GB")
    expect(formatGib(0)).toBe("0.0 GB")
  })

  test("aggregates process metrics across app processes", () => {
    const samples = [
      { type: "Browser", cpu: { percentCPUUsage: 2.31 }, memory: { workingSetSize: 1024 } },
      { type: "GPU", cpu: { percentCPUUsage: 0.51 }, memory: { workingSetSize: 2048 } },
      { type: "Tab", cpu: { percentCPUUsage: 4.44 }, memory: { workingSetSize: 4096 } },
      { type: "Tab", cpu: { percentCPUUsage: Number.NaN }, memory: { workingSetSize: 0 } },
    ]
    expect(aggregateAppProcesses(samples)).toEqual({
      cpuPercent: 7.3,
      gpuPercent: 0.5,
      memoryBytes: 7 * 1024 * 1024,
    })
  })

  test("reads the thermal scheduler limit from pmset output", () => {
    const output = "Note: No thermal warning level has been recorded\nCPU_Scheduler_Limit : 85\nCPU_Speed_Limit : 100\n"
    expect(parseCpuSpeedLimit(output)).toBe("85%")
    expect(parseCpuSpeedLimit("no limits here")).toBeUndefined()
  })
})
