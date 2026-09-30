import type { ScenarioId } from '../contracts/scenarios.ts'
import { getRuntimeOptions } from '../api/runtimeOptions.ts'
import { mulberry32 } from './random.ts'

/** Latency the handlers simulate, per scenario (ms). `?latencyMs=` replaces all of them. */
export const LATENCY = {
  base: 120,
  slow: 3_000,
  variableMin: 100,
  variableMax: 3_000,
  /**
   * `out_of_order`: the n-th GET (counted since the scenario was selected) waits
   * `pattern[n % 4]`, so within every group of four an earlier request is answered after a later one.
   */
  outOfOrder: [900, 600, 300, 50],
} as const

export const DEFAULT_MOCK_SEED = 1

let getCount = 0
let prng: (() => number) | null = null

/** Restarts the deterministic sequences (called on scenario change and on reset). */
export function resetLatencyPlanner(): void {
  getCount = 0
  prng = null
}

/**
 * Latency for the next request. Deterministic: `variable_latency` draws from a PRNG seeded with
 * `?mockSeed` (default 1) and `out_of_order` follows a fixed pattern.
 */
export function nextLatencyMs(scenario: ScenarioId, method: 'GET' | 'POST'): number {
  const options = getRuntimeOptions()
  let planned: number = LATENCY.base
  switch (scenario) {
    case 'slow':
      planned = LATENCY.slow
      break
    case 'variable_latency': {
      prng ??= mulberry32(options.mockSeed ?? DEFAULT_MOCK_SEED)
      planned = Math.round(
        LATENCY.variableMin + prng() * (LATENCY.variableMax - LATENCY.variableMin),
      )
      break
    }
    case 'out_of_order':
      if (method === 'GET') {
        planned = LATENCY.outOfOrder[getCount % LATENCY.outOfOrder.length] ?? LATENCY.base
        getCount += 1
      }
      break
    default:
      break
  }
  return options.latencyMs ?? planned
}

// ---------------------------------------------------------------------------------------------
// Cancellable delays: a handler must never keep a test (or a page) waiting on a dead request.
// ---------------------------------------------------------------------------------------------

const pending = new Set<() => void>()

/**
 * Resolves `true` after `ms`, or `false` as soon as `signal` aborts or `cancelPendingDelays()` runs.
 * Timers are unref'ed in Node so they can never keep a process alive.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  if (ms <= 0) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let handle: ReturnType<typeof setTimeout> | undefined
    const finish = (completed: boolean): void => {
      if (handle !== undefined) clearTimeout(handle)
      signal?.removeEventListener('abort', onAbort)
      pending.delete(cancel)
      resolve(completed)
    }
    const onAbort = (): void => finish(false)
    const cancel = (): void => finish(false)
    handle = setTimeout(() => finish(true), ms)
    ;(handle as { unref?: () => void }).unref?.()
    pending.add(cancel)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Wakes every sleeping handler with "cancelled" (tests `afterEach`, `resetMocks`). */
export function cancelPendingDelays(): void {
  for (const cancel of [...pending]) cancel()
}
