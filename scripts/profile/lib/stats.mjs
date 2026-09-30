/** Small statistics helpers shared by the profiling suites (no dependencies). */

/** Nearest-rank percentile on an ascending array; same definition as the game's `PerfSampler`. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

export const round = (value, digits = 2) => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

export function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

export function median(values) {
  return percentile(
    [...values].sort((a, b) => a - b),
    0.5,
  )
}

/**
 * Frame-time statistics for an array of frame intervals in ms.
 * `budgetMs` is the frame budget of the target (16.67 ms for 60 FPS).
 */
export function frameStats(dt, budgetMs = 1000 / 60) {
  const sorted = [...dt].sort((a, b) => a - b)
  const total = dt.reduce((sum, ms) => sum + ms, 0)
  const over = (limit) => dt.filter((ms) => ms > limit).length
  return {
    frames: dt.length,
    seconds: round(total / 1000, 2),
    avgFps: total > 0 ? round((dt.length / total) * 1000, 1) : 0,
    meanFrameMs: round(dt.length ? total / dt.length : 0, 3),
    minFrameMs: round(sorted[0] ?? 0, 3),
    p50FrameMs: round(percentile(sorted, 0.5), 3),
    p95FrameMs: round(percentile(sorted, 0.95), 3),
    p99FrameMs: round(percentile(sorted, 0.99), 3),
    maxFrameMs: round(sorted[sorted.length - 1] ?? 0, 3),
    framesOverBudget: over(budgetMs * 1.05),
    framesOver2xBudget: over(budgetMs * 2.05),
    framesOver50ms: over(50),
    pctOverBudget: round(dt.length ? (over(budgetMs * 1.05) / dt.length) * 100 : 0, 3),
  }
}

/**
 * Splits the samples in consecutive windows of `windowSec` seconds of frame time and reports
 * the FPS and p95 of each, to show whether performance drifts during the match.
 */
export function windowed(dt, windowSec = 10) {
  const windows = []
  let bucket = []
  let acc = 0
  for (const ms of dt) {
    bucket.push(ms)
    acc += ms
    if (acc >= windowSec * 1000) {
      windows.push(bucket)
      bucket = []
      acc = 0
    }
  }
  if (bucket.length > 0 && acc >= windowSec * 500) windows.push(bucket)
  return windows.map((samples, index) => {
    const s = frameStats(samples)
    return {
      window: index + 1,
      startSec: index * windowSec,
      frames: s.frames,
      avgFps: s.avgFps,
      p95FrameMs: s.p95FrameMs,
      maxFrameMs: s.maxFrameMs,
    }
  })
}

/** Least-squares slope of y over x (units of y per unit of x). */
export function slope(xs, ys) {
  const n = xs.length
  if (n < 2) return 0
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}
