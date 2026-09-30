// @vitest-environment jsdom
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API_PATHS } from '../contracts/api.ts'
import { DEFAULT_MATCH_CONFIG } from '../contracts/match.ts'
import { getRequestLog } from '../mocks/requestLog.ts'
import { setScenario } from '../mocks/scenario.ts'
import { server } from '../mocks/server.ts'
import { setupMockServer } from '../mocks/testing.ts'
import { makeSubmission } from '../mocks/testUtils.ts'
import { configureApi, getQueryRetries, getTimeoutMs } from './client.ts'
import { fetchPlayerMatches, fetchRanking, postMatch } from './endpoints.ts'
import { ApiError, isApiError } from './errors.ts'
import { setRuntimeOptions } from './runtimeOptions.ts'

setupMockServer()

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(isApiError(error)).toBe(true)
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('endpoints', () => {
  it('return contract-validated data', async () => {
    const ranking = await fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10)
    expect(ranking.total).toBe(27)
    const history = await fetchPlayerMatches('player-test-0001', 1, 10)
    expect(history.items).toEqual([])
    const submission = makeSubmission()
    const created = await postMatch(submission)
    expect(created).toMatchObject({ duplicate: false, record: { matchId: submission.matchId } })
    expect((await postMatch(submission)).duplicate).toBe(true)
  })

  it('send every parameter of the request', async () => {
    await fetchRanking({ sessionSeconds: 120, spawnIntervalMs: 2_000 }, 2, 5)
    await fetchPlayerMatches('player-test-0001', 3, 20)
    const seen: string[] = []
    server.use(
      http.get(API_PATHS.ranking, ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 })
      }),
    )
    await fetchRanking({ sessionSeconds: 120, spawnIntervalMs: 2_000 }, 2, 5)
    expect(seen).toEqual(['?sessionSeconds=120&spawnIntervalMs=2000&page=2&pageSize=5'])
  })
})

describe('error normalisation', () => {
  it('network failure -> kind network, retryable, user-safe message', async () => {
    setScenario('network_error')
    const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))
    expect(error).toMatchObject({ kind: 'network', status: null, retryable: true })
    expect(error.message).toMatch(/connection/i)
    expect(error.message).not.toMatch(/axios|localhost|ERR_/)
  })

  it('timeout -> kind timeout, retryable, honours the configured timeout', async () => {
    setScenario('timeout')
    configureApi({ timeoutMs: 80 })
    expect(getTimeoutMs()).toBe(80)
    const started = Date.now()
    const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(error).toMatchObject({ kind: 'timeout', retryable: true })
    expect(error.message).toMatch(/too long/i)
  })

  it('?timeoutMs takes precedence over configureApi', () => {
    configureApi({ timeoutMs: 80 })
    setRuntimeOptions({ timeoutMs: 1_234 })
    expect(getTimeoutMs()).toBe(1_234)
  })

  it('4xx -> kind http with the server message, not retryable', async () => {
    setScenario('http_4xx')
    const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))
    expect(error).toMatchObject({ kind: 'http', status: 404, code: 'not_found', retryable: false })
    expect(error.message).toMatch(/4xx scenario/)
  })

  it('5xx -> kind http with a generic message (server text is not shown), retryable', async () => {
    setScenario('http_5xx')
    const error = await failure(fetchPlayerMatches('player-test-0001', 1, 10))
    expect(error).toMatchObject({ kind: 'http', status: 500, retryable: true })
    expect(error.message).not.toMatch(/mock/i)
  })

  it('503 has its own message; 409 is a clear conflict, not retryable', async () => {
    setScenario('submit_outage')
    const outage = await failure(postMatch(makeSubmission()))
    expect(outage).toMatchObject({ kind: 'http', status: 503, retryable: true })
    expect(outage.message).toMatch(/unavailable/i)

    setScenario('success')
    const submission = makeSubmission({ score: 3 })
    await postMatch(submission)
    const conflict = await failure(postMatch({ ...submission, score: 4 }))
    expect(conflict).toMatchObject({ kind: 'http', status: 409, retryable: false })
    expect(conflict.message).toMatch(/already registered with different data/i)
  })

  it('400 validation errors are not retryable and carry the field message', async () => {
    const bad = { ...makeSubmission(), score: 999 }
    const error = await failure(postMatch(bad))
    expect(error).toMatchObject({ kind: 'http', status: 400, retryable: false })
    expect(error.message).toMatch(/score/)
  })

  it('treats 429 and 408 as retryable but other 4xx as not', async () => {
    for (const [status, retryable] of [
      [429, true],
      [408, true],
      [400, false],
      [401, false],
      [404, false],
    ] as const) {
      server.use(
        http.get(API_PATHS.ranking, () =>
          HttpResponse.json({ error: { code: 'x', message: 'nope' } }, { status }),
        ),
      )
      const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))
      expect(error.retryable, String(status)).toBe(retryable)
      server.resetHandlers()
    }
  })

  it('a non-JSON error body still yields a user-safe http error', async () => {
    server.use(
      http.get(API_PATHS.ranking, () => new HttpResponse('<html>boom</html>', { status: 502 })),
    )
    const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))
    expect(error).toMatchObject({ kind: 'http', status: 502, code: null })
    expect(error.message).not.toContain('<html>')
  })
})

describe('invalid payloads never reach the caller', () => {
  it.each([
    ['wrong shape', { items: 'nope' }],
    ['missing field', { items: [], page: 1, pageSize: 10, total: 0 }],
    [
      'unknown key (strict schema)',
      { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0, extra: 1 },
    ],
    [
      'invalid item',
      {
        items: [{ rank: 0, matchId: 'x' }],
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    ],
    ['null', null],
    ['array', []],
  ])('rejects %s with invalid_response', async (_label, payload) => {
    server.use(http.get(API_PATHS.ranking, () => HttpResponse.json(payload)))
    const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))
    expect(error).toMatchObject({ kind: 'invalid_response', retryable: false })
    expect(error.message).not.toMatch(/zod|schema|undefined/i)
  })

  it('rejects a 2xx text body and an unexpected POST answer', async () => {
    server.use(
      http.get(API_PATHS.ranking, () => new HttpResponse('OK', { status: 200 })),
      http.post(API_PATHS.matches, () => HttpResponse.json({ ok: true }, { status: 201 })),
    )
    expect((await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10))).kind).toBe('invalid_response')
    expect((await failure(postMatch(makeSubmission()))).kind).toBe('invalid_response')
  })
})

describe('cancellation', () => {
  it('an aborted request rejects quietly with kind aborted', async () => {
    setScenario('timeout')
    const controller = new AbortController()
    const pending = failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10, controller.signal))
    controller.abort()
    const error = await pending
    expect(error).toMatchObject({ kind: 'aborted', retryable: false })
    expect(getRequestLog().length).toBeLessThanOrEqual(1)
  })

  it('an already aborted signal never hits the network', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await failure(fetchRanking(DEFAULT_MATCH_CONFIG, 1, 10, controller.signal))
    expect(error.kind).toBe('aborted')
    expect(getRequestLog()).toHaveLength(0)
  })
})

describe('configuration', () => {
  it('query retries: default 2, configurable, ?retry wins', () => {
    setRuntimeOptions({ retry: null })
    expect(getQueryRetries()).toBe(2)
    configureApi({ queryRetries: 1 })
    expect(getQueryRetries()).toBe(1)
    setRuntimeOptions({ retry: 0 })
    expect(getQueryRetries()).toBe(0)
  })
})
