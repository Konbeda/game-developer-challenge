// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRuntimeOptions, setRuntimeOptions } from '../api/runtimeOptions.ts'
import { SCENARIO_IDS } from '../contracts/scenarios.ts'
import { STORAGE_KEYS } from '../lib/storage.ts'
import { getScenario, resetMocks, setScenario, subscribeScenario } from './index.ts'
import {
  DEFAULT_MOCK_SEED,
  LATENCY,
  cancelPendingDelays,
  nextLatencyMs,
  resetLatencyPlanner,
  sleep,
} from './latency.ts'
import { reloadScenarioFromEnvironment } from './scenario.ts'
import { setupMockServer } from './testing.ts'

setupMockServer()

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`)
}

afterEach(() => {
  setUrl('')
  reloadScenarioFromEnvironment()
})

describe('scenario selection', () => {
  it('defaults to success', () => {
    expect(getScenario()).toBe('success')
  })

  it('persists the selection in localStorage and restores it', () => {
    setScenario('submit_outage')
    expect(getScenario()).toBe('submit_outage')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.mockScenario)!)).toBe(
      'submit_outage',
    )
    reloadScenarioFromEnvironment() // simulates a page reload
    expect(getScenario()).toBe('submit_outage')
  })

  it('accepts every scenario id', () => {
    for (const id of SCENARIO_IDS) {
      setScenario(id)
      expect(getScenario()).toBe(id)
    }
  })

  it('ignores unknown ids', () => {
    setScenario('timeout')
    setScenario('../evil' as never)
    expect(getScenario()).toBe('timeout')
  })

  it.each([
    ['garbage text', 'not json{'],
    ['unknown id', JSON.stringify('rm -rf')],
    ['wrong type', JSON.stringify({ id: 'timeout' })],
    ['null', 'null'],
  ])('falls back to the default when storage holds %s', (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEYS.mockScenario, raw)
    reloadScenarioFromEnvironment()
    expect(getScenario()).toBe('success')
  })

  it('lets ?scenario= override storage without persisting it', () => {
    setScenario('slow')
    setUrl('?scenario=http_5xx')
    reloadScenarioFromEnvironment()
    expect(getScenario()).toBe('http_5xx')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.mockScenario)!)).toBe('slow')
  })

  it('validates ?scenario= against the allowlist', () => {
    setScenario('slow')
    for (const value of ['nope', '', '<script>', 'SUCCESS', 'success%00']) {
      setUrl(`?scenario=${encodeURIComponent(value)}`)
      reloadScenarioFromEnvironment()
      expect(getScenario()).toBe('slow')
    }
  })

  it('rewrites the URL parameter when the scenario changes so a reload cannot contradict it', () => {
    setUrl('?scenario=submit_outage&other=1')
    reloadScenarioFromEnvironment()
    expect(getScenario()).toBe('submit_outage')
    setScenario('success')
    expect(new URLSearchParams(window.location.search).get('scenario')).toBe('success')
    expect(new URLSearchParams(window.location.search).get('other')).toBe('1')
    reloadScenarioFromEnvironment()
    expect(getScenario()).toBe('success')
  })

  it('does not add a scenario parameter to a URL that had none', () => {
    setScenario('slow')
    expect(window.location.search).toBe('')
  })

  it('notifies subscribers only when the scenario changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeScenario(listener)
    setScenario('timeout')
    setScenario('timeout')
    setScenario('slow')
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    setScenario('success')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('resetMocks', () => {
  it('restores the default scenario and forgets storage and URL choices', () => {
    setUrl('?scenario=timeout')
    reloadScenarioFromEnvironment()
    setScenario('history_fails')
    resetMocks()
    expect(getScenario()).toBe('success')
    expect(window.localStorage.getItem(STORAGE_KEYS.mockScenario)).toBeNull()
    expect(window.location.search).toBe('')
  })
})

describe('runtime options', () => {
  it('reads and bounds URL controls', () => {
    setRuntimeOptions(null)
    setUrl('?latencyMs=250&mockSeed=42&retry=2&timeoutMs=500')
    expect(getRuntimeOptions()).toEqual({ latencyMs: 250, mockSeed: 42, retry: 2, timeoutMs: 500 })
    for (const search of [
      '?latencyMs=5001',
      '?latencyMs=-1',
      '?latencyMs=abc',
      '?latencyMs=1.5',
      '?latencyMs=',
      '?mockSeed=4294967296',
      '?retry=4',
      '?retry=-1',
      '?timeoutMs=10',
      '?timeoutMs=30001',
    ]) {
      setUrl(search)
      expect(getRuntimeOptions(), search).toEqual({
        latencyMs: null,
        mockSeed: null,
        retry: null,
        timeoutMs: null,
      })
    }
    setUrl('?latencyMs=5000&mockSeed=4294967295&retry=3&timeoutMs=30000')
    expect(getRuntimeOptions()).toEqual({
      latencyMs: 5000,
      mockSeed: 4294967295,
      retry: 3,
      timeoutMs: 30000,
    })
  })

  it('lets the programmatic override win and validates it too', () => {
    setRuntimeOptions(null)
    setUrl('?retry=3')
    setRuntimeOptions({ retry: 0 })
    expect(getRuntimeOptions().retry).toBe(0)
    setRuntimeOptions({ retry: 99 })
    expect(getRuntimeOptions().retry).toBe(0)
    setRuntimeOptions({ retry: null })
    expect(getRuntimeOptions().retry).toBeNull()
    setRuntimeOptions(null)
    expect(getRuntimeOptions().retry).toBe(3)
  })
})

describe('latency planning', () => {
  it('uses fixed latency for every scenario when ?latencyMs is set', () => {
    setRuntimeOptions({ latencyMs: 0 })
    for (const id of SCENARIO_IDS) expect(nextLatencyMs(id, 'GET')).toBe(0)
  })

  it('has realistic defaults when no override is present', () => {
    setRuntimeOptions({ latencyMs: null })
    expect(nextLatencyMs('success', 'GET')).toBe(LATENCY.base)
    expect(nextLatencyMs('slow', 'GET')).toBe(LATENCY.slow)
  })

  it('variable latency is seeded: same seed, same sequence; different seed, different one', () => {
    setRuntimeOptions({ latencyMs: null, mockSeed: 7 })
    const run = (): number[] => {
      resetLatencyPlanner()
      return Array.from({ length: 12 }, () => nextLatencyMs('variable_latency', 'GET'))
    }
    const a = run()
    expect(run()).toEqual(a)
    expect(a.every((ms) => ms >= LATENCY.variableMin && ms <= LATENCY.variableMax)).toBe(true)
    expect(new Set(a).size).toBeGreaterThan(6)
    setRuntimeOptions({ mockSeed: 8 })
    expect(run()).not.toEqual(a)
    setRuntimeOptions({ mockSeed: null })
    expect(DEFAULT_MOCK_SEED).toBe(1)
    expect(run()).toEqual(run())
  })

  it('out_of_order answers earlier GETs later, deterministically', () => {
    setRuntimeOptions({ latencyMs: null })
    resetLatencyPlanner()
    const plan = Array.from({ length: 8 }, () => nextLatencyMs('out_of_order', 'GET'))
    expect(plan).toEqual([...LATENCY.outOfOrder, ...LATENCY.outOfOrder])
    // within a group of four, request n answers after request n + 1
    for (let i = 0; i < 3; i += 1) expect(plan[i]!).toBeGreaterThan(plan[i + 1]!)
    // POST is not reordered and does not consume the pattern
    expect(nextLatencyMs('out_of_order', 'POST')).toBe(LATENCY.base)
    resetLatencyPlanner()
    expect(nextLatencyMs('out_of_order', 'GET')).toBe(LATENCY.outOfOrder[0])
  })
})

describe('cancellable delays', () => {
  it('resolves true when the time passes and false when aborted or cancelled', async () => {
    vi.useFakeTimers()
    try {
      const done = sleep(1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(done).resolves.toBe(true)

      const controller = new AbortController()
      const aborted = sleep(60_000, controller.signal)
      controller.abort()
      await expect(aborted).resolves.toBe(false)
      await expect(sleep(60_000, controller.signal)).resolves.toBe(false)

      const cancelled = sleep(60_000)
      cancelPendingDelays()
      await expect(cancelled).resolves.toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
