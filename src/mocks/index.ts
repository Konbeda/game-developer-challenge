import { resetApiState } from '../api/state.ts'
import { resetDb } from './db.ts'
import { cancelPendingDelays, resetLatencyPlanner } from './latency.ts'
import { clearRequestLog } from './requestLog.ts'
import { getScenario, resetScenario, setScenario, subscribeScenario } from './scenario.ts'

export { getScenario, setScenario, subscribeScenario }
export { useScenario } from './useScenario.ts'
export { getRequestLog, clearRequestLog } from './requestLog.ts'

let starting: Promise<void> | null = null

async function start(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      // No Service Worker support (very old browser, insecure context): the app runs unmocked.
      console.warn('[mocks] Service Workers are unavailable; API mocks are disabled.')
      return
    }
    const { worker } = await import('./browser.ts')
    await worker.start({
      // Static assets (/assets, /bundle, fonts, the worker file itself) are not API traffic.
      onUnhandledFrame: 'bypass',
      quiet: true,
      // Resolved from the site root so it also works after a reload of any route.
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    })
  } catch (error) {
    // A mock failure must never block the app.
    console.warn('[mocks] Could not start the mock service worker.', error)
  }
}

/**
 * Starts MSW (service worker) with the shared handlers. Resolves when the worker controls the
 * page; never rejects. Safe to call repeatedly (React Strict Mode, HMR): it starts only once.
 * Works in the production build: the worker script is served from `public/mockServiceWorker.js`.
 */
export function enableMocking(): Promise<void> {
  starting ??= start()
  return starting
}

/**
 * Restores the initial state so a demo or a test starts clean:
 *  - scenario back to `success` (stored and `?scenario=` value forgotten);
 *  - mock database back to the deterministic fixtures (drops the player's confirmed records);
 *  - latency sequences and the request log restart, sleeping handlers are woken;
 *  - the local outbox is cleared too (queued/failed/synced submissions and their timers), so the
 *    reset is total and nothing is re-sent afterwards; the query cache is reset and active screens
 *    refetch.
 * It does not touch the player's options, name or last result (owned by the UI).
 */
export function resetMocks(): void {
  cancelPendingDelays()
  resetScenario()
  resetLatencyPlanner()
  resetDb()
  clearRequestLog()
  resetApiState()
}
