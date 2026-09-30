import { DEFAULT_SCENARIO, scenarioIdSchema, type ScenarioId } from '../contracts/scenarios.ts'
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '../lib/storage.ts'
import { resetLatencyPlanner } from './latency.ts'

/**
 * Active network scenario.
 *
 * Resolution order on first use: URL query `?scenario=<id>` (allowlist-validated) >
 * localStorage (validated) > `success`. A URL value applies to this page load only (it is not
 * written to storage); `setScenario` persists the choice, applies it immediately and, when the URL
 * carries a `scenario` parameter, rewrites it (history.replaceState, no reload) so the address bar
 * never contradicts the active scenario after a reload.
 */
let current: ScenarioId | null = null
const listeners = new Set<() => void>()

function scenarioFromUrl(): ScenarioId | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = new URLSearchParams(window.location.search).get('scenario')
    if (raw === null) return null
    const parsed = scenarioIdSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function syncUrl(id: ScenarioId | null): void {
  try {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('scenario')) return
    if (id === null) url.searchParams.delete('scenario')
    else url.searchParams.set('scenario', id)
    window.history.replaceState(window.history.state, '', url)
  } catch {
    // history unavailable: the address bar is informative only
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

export function getScenario(): ScenarioId {
  current ??=
    scenarioFromUrl() ?? readStorage(STORAGE_KEYS.mockScenario, scenarioIdSchema, DEFAULT_SCENARIO)
  return current
}

/** Persists the scenario and applies it to subsequent requests. Unknown ids are ignored. */
export function setScenario(id: ScenarioId): void {
  const parsed = scenarioIdSchema.safeParse(id)
  if (!parsed.success) return
  const changed = getScenario() !== parsed.data
  current = parsed.data
  writeStorage(STORAGE_KEYS.mockScenario, parsed.data)
  syncUrl(parsed.data)
  // Deterministic sequences (variable latency, out-of-order) start over with each selection.
  resetLatencyPlanner()
  if (changed) notify()
}

/** Back to the default scenario, forgetting the stored/URL choice. */
export function resetScenario(): void {
  const changed = getScenario() !== DEFAULT_SCENARIO
  current = DEFAULT_SCENARIO
  removeStorage(STORAGE_KEYS.mockScenario)
  syncUrl(null)
  resetLatencyPlanner()
  if (changed) notify()
}

/** For `useSyncExternalStore` (dev panel). */
export function subscribeScenario(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Forgets the in-memory value so the next `getScenario()` re-reads URL/storage (tests). */
export function reloadScenarioFromEnvironment(): void {
  current = null
}
