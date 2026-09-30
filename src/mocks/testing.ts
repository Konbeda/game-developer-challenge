import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { resetApiConfig } from '../api/client.ts'
import { setRuntimeOptions } from '../api/runtimeOptions.ts'
import { resetMocks } from './index.ts'
import { cancelPendingDelays } from './latency.ts'
import { reloadScenarioFromEnvironment } from './scenario.ts'
import { server } from './server.ts'

/**
 * Vitest helper: run a test file against the shared MSW handlers (`// @vitest-environment jsdom`).
 * Registers lifecycle hooks; call it at the top level of a test file.
 *
 * Every test starts from the initial state (default scenario, fixtures only, empty outbox) with
 * deterministic controls: no artificial latency, seed 1, no automatic GET retries.
 */
export function setupMockServer(): void {
  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' })
  })
  beforeEach(() => {
    window.localStorage.clear()
    reloadScenarioFromEnvironment()
    resetApiConfig()
    setRuntimeOptions(null)
    setRuntimeOptions({ latencyMs: 0, mockSeed: 1, retry: 0 })
    resetMocks()
  })
  afterEach(() => {
    cancelPendingDelays()
    server.resetHandlers()
  })
  afterAll(() => {
    cancelPendingDelays()
    server.close()
  })
}
