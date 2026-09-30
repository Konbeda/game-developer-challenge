import { z } from 'zod'

/** Network scenarios served by the MSW layer (README section 6). Selectable in dev panel or `?scenario=`. */
export const SCENARIO_IDS = [
  'success', // default: healthy API with fixtures
  'empty', // ranking and history return empty pages
  'many_pages', // enough fixtures for several pages
  'slow', // fixed high latency
  'variable_latency', // seeded, varying latency
  'out_of_order', // earlier requests answer after later ones
  'timeout', // requests never answer within the client timeout
  'network_error', // connection failures
  'http_4xx', // 4xx on all endpoints
  'http_5xx', // 5xx on all endpoints
  'ranking_fails', // only GET /api/ranking fails
  'history_fails', // only GET /api/players/:id/matches fails
  'submit_timeout_after_commit', // POST commits, then times out (retry must not duplicate)
  'submit_outage', // POST unavailable until the scenario is changed/reset
] as const

export const scenarioIdSchema = z.enum(SCENARIO_IDS)
export type ScenarioId = z.infer<typeof scenarioIdSchema>

export const DEFAULT_SCENARIO: ScenarioId = 'success'

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  success: 'Success',
  empty: 'Empty lists',
  many_pages: 'Many pages',
  slow: 'Slow responses',
  variable_latency: 'Variable latency',
  out_of_order: 'Out-of-order responses',
  timeout: 'Request timeout',
  network_error: 'Connection failure',
  http_4xx: 'HTTP 4xx',
  http_5xx: 'HTTP 5xx',
  ranking_fails: 'Ranking fails',
  history_fails: 'History fails',
  submit_timeout_after_commit: 'Submit times out after commit',
  submit_outage: 'Submit outage',
}
