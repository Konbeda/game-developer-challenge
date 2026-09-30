import { http, HttpResponse } from 'msw'
import {
  API_PATHS,
  apiErrorSchema,
  matchHistoryPageSchema,
  paginationQuerySchema,
  playerMatchesParamsSchema,
  rankingPageSchema,
  rankingQuerySchema,
  submitMatchResponseSchema,
} from '../contracts/api.ts'
import {
  compareRanking,
  matchSubmissionSchema,
  type MatchRecord,
  type MatchSubmission,
  type RankingEntry,
} from '../contracts/match.ts'
import type { ScenarioId } from '../contracts/scenarios.ts'
import { commitSubmission, historySource, rankingSource } from './db.ts'
import { nextLatencyMs, sleep } from './latency.ts'
import { logRequest } from './requestLog.ts'
import { getScenario } from './scenario.ts'

/**
 * MSW handlers implementing the REST contract of `src/contracts/api.ts`. The same array is used by
 * the browser worker (dev, preview and the published build), by `setupServer` in Vitest and by any
 * E2E run, so a scenario behaves identically everywhere.
 *
 * Request flow: pick the scenario -> plan latency -> decide the fault (if any) -> compute the answer
 * from the data as it is when the request ARRIVES -> wait -> deliver. Computing before waiting is
 * what makes slow/out-of-order responses genuinely stale, like a real server.
 */

type Endpoint = 'ranking' | 'history' | 'submit'

type Fault =
  | { kind: 'none' }
  | { kind: 'network' }
  | { kind: 'hang' }
  | { kind: 'error'; status: number; code: string; message: string }

/** How long a "never answers" request is held (the client aborts long before that). */
const HANG_MS = 120_000
/** Bodies larger than this are rejected before parsing. A valid submission is under 500 bytes. */
const MAX_BODY_CHARS = 4_096

const NO_FAULT: Fault = { kind: 'none' }

function serverError(message = 'Internal server error (mock scenario).'): Fault {
  return { kind: 'error', status: 500, code: 'internal_error', message }
}

/** Which fault a scenario injects on which endpoint. Pure, so tests can enumerate it. */
export function faultFor(endpoint: Endpoint, scenario: ScenarioId): Fault {
  switch (scenario) {
    case 'timeout':
      return { kind: 'hang' }
    case 'network_error':
      return { kind: 'network' }
    case 'http_4xx':
      return endpoint === 'submit'
        ? {
            kind: 'error',
            status: 422,
            code: 'unprocessable',
            message: 'The mock API rejected this request (HTTP 4xx scenario).',
          }
        : {
            kind: 'error',
            status: 404,
            code: 'not_found',
            message: 'The mock API could not find this resource (HTTP 4xx scenario).',
          }
    case 'http_5xx':
      return serverError()
    case 'ranking_fails':
      return endpoint === 'ranking'
        ? serverError('Ranking is unavailable (mock scenario).')
        : NO_FAULT
    case 'history_fails':
      return endpoint === 'history'
        ? serverError('History is unavailable (mock scenario).')
        : NO_FAULT
    case 'submit_outage':
      return endpoint === 'submit'
        ? {
            kind: 'error',
            status: 503,
            code: 'service_unavailable',
            message: 'Match registration is unavailable (mock outage).',
          }
        : NO_FAULT
    default:
      return NO_FAULT
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return HttpResponse.json(apiErrorSchema.parse({ error: { code, message } }), { status })
}

interface Issue {
  code: string
  message: string
  path: readonly PropertyKey[]
}

/** Human readable, bounded validation summary that never echoes raw input values. */
function describeIssues(issues: readonly Issue[], fields: ReadonlySet<string>): string {
  const parts = new Set<string>()
  for (const issue of issues.slice(0, 5)) {
    if (issue.code === 'unrecognized_keys') {
      parts.add('unknown field(s) are not allowed')
      continue
    }
    const field = issue.path.find((p): p is string => typeof p === 'string' && fields.has(p))
    parts.add(`${field ?? 'request'}: ${issue.message}`)
  }
  return [...parts].join('; ').slice(0, 480)
}

const QUERY_FIELDS: ReadonlySet<string> = new Set([
  'sessionSeconds',
  'spawnIntervalMs',
  'page',
  'pageSize',
  'playerId',
])
const BODY_FIELDS: ReadonlySet<string> = new Set([
  'matchId',
  'playerId',
  'playerName',
  'playedAt',
  'score',
  'durationMs',
  'endReason',
  'config',
  'sessionSeconds',
  'spawnIntervalMs',
  'seed',
])

function queryObject(url: URL): Record<string, string> | null {
  const result: Record<string, string> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    if (values.length !== 1) return null // repeated parameters are ambiguous: reject
    result[key] = values[0] ?? ''
  }
  return result
}

function paginate<T>(items: readonly T[], page: number, pageSize: number) {
  const total = items.length
  const start = (page - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  }
}

function toRankingEntry(record: MatchRecord, rank: number): RankingEntry {
  return {
    rank,
    matchId: record.matchId,
    playerId: record.playerId,
    playerName: record.playerName,
    score: record.score,
    durationMs: record.durationMs,
    playedAt: record.playedAt,
    config: record.config,
  }
}

function newestFirst(a: MatchRecord, b: MatchRecord): number {
  if (a.playedAt !== b.playedAt) return a.playedAt < b.playedAt ? 1 : -1
  return a.matchId < b.matchId ? 1 : a.matchId > b.matchId ? -1 : 0
}

/** Ranking answer computed from the current data (`rank` counts over the whole filtered list). */
function buildRanking(url: URL, scenario: ScenarioId): Response {
  const query = queryObject(url)
  const parsed = rankingQuerySchema.safeParse(query ?? { invalid: 'duplicate' })
  if (!parsed.success) {
    return errorResponse(400, 'invalid_query', describeIssues(parsed.error.issues, QUERY_FIELDS))
  }
  const { page, pageSize, ...config } = parsed.data
  const source = scenario === 'empty' ? [] : rankingSource(config, scenario)
  const ranked = [...source]
    .sort(compareRanking)
    .map((record, index) => toRankingEntry(record, index + 1))
  return HttpResponse.json(rankingPageSchema.parse(paginate(ranked, page, pageSize)))
}

function buildHistory(url: URL, playerIdParam: unknown, scenario: ScenarioId): Response {
  const params = playerMatchesParamsSchema.safeParse({ playerId: playerIdParam })
  if (!params.success) {
    return errorResponse(400, 'invalid_player', describeIssues(params.error.issues, QUERY_FIELDS))
  }
  const query = queryObject(url)
  const parsed = paginationQuerySchema.safeParse(query ?? { invalid: 'duplicate' })
  if (!parsed.success) {
    return errorResponse(400, 'invalid_query', describeIssues(parsed.error.issues, QUERY_FIELDS))
  }
  const { page, pageSize } = parsed.data
  const source = scenario === 'empty' ? [] : historySource(params.data.playerId, scenario)
  const sorted = [...source].sort(newestFirst)
  return HttpResponse.json(matchHistoryPageSchema.parse(paginate(sorted, page, pageSize)))
}

type SubmissionResult = { ok: true; data: MatchSubmission } | { ok: false; response: Response }

async function readSubmission(request: Request): Promise<SubmissionResult> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'invalid_body', 'The request body could not be read.'),
    }
  }
  if (text.length > MAX_BODY_CHARS) {
    return {
      ok: false,
      response: errorResponse(413, 'payload_too_large', 'The request body is too large.'),
    }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'invalid_json', 'The request body is not valid JSON.'),
    }
  }
  const parsed = matchSubmissionSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'validation_error',
        describeIssues(parsed.error.issues, BODY_FIELDS),
      ),
    }
  }
  return { ok: true, data: parsed.data }
}

function commitAndRespond(submission: MatchSubmission): { response: Response; created: boolean } {
  const result = commitSubmission(submission, new Date().toISOString())
  switch (result.kind) {
    case 'created':
      return {
        created: true,
        response: HttpResponse.json(
          submitMatchResponseSchema.parse({ record: result.record, duplicate: false }),
          { status: 201 },
        ),
      }
    case 'duplicate':
      return {
        created: false,
        response: HttpResponse.json(
          submitMatchResponseSchema.parse({ record: result.record, duplicate: true }),
          { status: 200 },
        ),
      }
    case 'conflict':
      return {
        created: false,
        response: errorResponse(
          409,
          result.reason === 'reserved_id' ? 'reserved_id' : 'match_conflict',
          result.reason === 'reserved_id'
            ? 'This match id is reserved.'
            : 'This match id already exists with different data.',
        ),
      }
  }
}

/** Waits the planned latency, then answers, fails or hangs. Aborted requests answer nothing useful. */
async function deliver(
  signal: AbortSignal,
  latencyMs: number,
  fault: Fault,
  ready: Response | null,
): Promise<Response> {
  if (fault.kind === 'hang') {
    const completed = await sleep(HANG_MS, signal)
    return completed
      ? errorResponse(504, 'gateway_timeout', 'The mock API did not answer in time.')
      : HttpResponse.error()
  }
  if (!(await sleep(latencyMs, signal))) return HttpResponse.error()
  switch (fault.kind) {
    case 'network':
      return HttpResponse.error()
    case 'error':
      return errorResponse(fault.status, fault.code, fault.message)
    default:
      return ready ?? errorResponse(500, 'internal_error', 'No response was prepared.')
  }
}

export const handlers = [
  http.get(API_PATHS.ranking, async ({ request }) => {
    const url = new URL(request.url)
    const scenario = getScenario()
    logRequest('GET', url.pathname, scenario)
    const latencyMs = nextLatencyMs(scenario, 'GET')
    const fault = faultFor('ranking', scenario)
    const ready = fault.kind === 'none' ? buildRanking(url, scenario) : null
    return deliver(request.signal, latencyMs, fault, ready)
  }),

  http.get(API_PATHS.playerMatchesPattern, async ({ request, params }) => {
    const url = new URL(request.url)
    const scenario = getScenario()
    logRequest('GET', url.pathname, scenario)
    const latencyMs = nextLatencyMs(scenario, 'GET')
    const fault = faultFor('history', scenario)
    const rawPlayerId = params['playerId']
    const ready =
      fault.kind === 'none'
        ? buildHistory(url, typeof rawPlayerId === 'string' ? rawPlayerId : undefined, scenario)
        : null
    return deliver(request.signal, latencyMs, fault, ready)
  }),

  http.post(API_PATHS.matches, async ({ request }) => {
    const url = new URL(request.url)
    const scenario = getScenario()
    logRequest('POST', url.pathname, scenario)
    const latencyMs = nextLatencyMs(scenario, 'POST')
    const fault = faultFor('submit', scenario)
    if (fault.kind !== 'none') return deliver(request.signal, latencyMs, fault, null)

    const body = await readSubmission(request)
    if (!body.ok) return deliver(request.signal, latencyMs, NO_FAULT, body.response)

    const { response, created } = commitAndRespond(body.data)
    // The record is committed either way; in this scenario the client just never hears about it.
    // The retry finds the record (duplicate: true) and is answered normally.
    const hang = scenario === 'submit_timeout_after_commit' && created
    return deliver(request.signal, latencyMs, hang ? { kind: 'hang' } : NO_FAULT, response)
  }),
]
