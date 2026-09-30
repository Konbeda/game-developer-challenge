import type { ScenarioId } from '../contracts/scenarios.ts'

// STUB: owned by the network work. MSW bootstrap and scenario control (persisted, also in the production build).

/** Starts MSW (service worker). Resolves when ready; must not reject (mock failure must not block the app). */
export async function enableMocking(): Promise<void> {
  // implemented by the network work
}

export function getScenario(): ScenarioId {
  throw new Error('Not implemented')
}

/** Persists the scenario and applies it to subsequent requests. */
export function setScenario(_id: ScenarioId): void {
  throw new Error('Not implemented')
}

/** Restores the initial state: default scenario, fixtures only, no confirmed/pending player records. */
export function resetMocks(): void {
  throw new Error('Not implemented')
}
