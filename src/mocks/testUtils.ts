import { DEFAULT_MATCH_CONFIG, type MatchSubmission } from '../contracts/match.ts'

/** Helpers shared by the network tests (jsdom environment). */

export interface CallResult {
  status: number
  /** Parsed JSON body, or null when the body was not JSON. Tests assert on its shape right after. */
  body: any
}

/** Plain `fetch` against the mocked same-origin API. */
export async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  rawBody?: string,
): Promise<CallResult> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (rawBody !== undefined) init.body = rawBody
  else if (body !== undefined) init.body = JSON.stringify(body)
  const response = await fetch(new URL(path, window.location.origin), init)
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return { status: response.status, body: parsed }
}

let counter = 0

/** A legitimate 90 s / 3 s submission with a unique matchId. */
export function makeSubmission(overrides: Partial<MatchSubmission> = {}): MatchSubmission {
  counter += 1
  return {
    matchId: `match-${String(counter).padStart(6, '0')}-test`,
    playerId: 'player-test-0001',
    playerName: 'Captain',
    playedAt: '2026-09-29T12:00:00.000Z',
    score: 10,
    durationMs: 90_000,
    endReason: 'time_up',
    config: { ...DEFAULT_MATCH_CONFIG },
    seed: 42,
    ...overrides,
  }
}
