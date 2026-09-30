/**
 * Frame-time sampler for the profiling report (README section 9). Enabled with `?perf=1` or the
 * E2E build flag; otherwise it costs nothing. Results are read through `window.__perf`.
 */
export interface PerfSummary {
  frames: number
  seconds: number
  avgFps: number
  p50FrameMs: number
  p95FrameMs: number
  p99FrameMs: number
  maxFrameMs: number
  maxEntities: number
  avgEntities: number
}

export interface PerfProbe {
  reset(): void
  summary(): PerfSummary
}

declare global {
  interface Window {
    __perf?: PerfProbe
  }
}

const MAX_SAMPLES = 40_000

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

export function isPerfEnabled(): boolean {
  if (import.meta.env.VITE_E2E === 'true') return true
  return new URLSearchParams(window.location.search).get('perf') === '1'
}

export class PerfSampler implements PerfProbe {
  private frames: number[] = []
  private entitySum = 0
  private entityMax = 0

  record(frameMs: number, entities: number): void {
    if (this.frames.length >= MAX_SAMPLES) return
    this.frames.push(frameMs)
    this.entitySum += entities
    if (entities > this.entityMax) this.entityMax = entities
  }

  reset(): void {
    this.frames = []
    this.entitySum = 0
    this.entityMax = 0
  }

  summary(): PerfSummary {
    const sorted = [...this.frames].sort((a, b) => a - b)
    const total = this.frames.reduce((sum, ms) => sum + ms, 0)
    const count = this.frames.length
    return {
      frames: count,
      seconds: total / 1000,
      avgFps: total > 0 ? (count / total) * 1000 : 0,
      p50FrameMs: percentile(sorted, 0.5),
      p95FrameMs: percentile(sorted, 0.95),
      p99FrameMs: percentile(sorted, 0.99),
      maxFrameMs: sorted[sorted.length - 1] ?? 0,
      maxEntities: this.entityMax,
      avgEntities: count > 0 ? this.entitySum / count : 0,
    }
  }
}
