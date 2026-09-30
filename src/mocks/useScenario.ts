import { useSyncExternalStore } from 'react'
import type { ScenarioId } from '../contracts/scenarios.ts'
import { getScenario, subscribeScenario } from './scenario.ts'

/** Live active scenario for the dev panel. */
export function useScenario(): ScenarioId {
  return useSyncExternalStore(subscribeScenario, getScenario, getScenario)
}
