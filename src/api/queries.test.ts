// @vitest-environment jsdom
import { focusManager, QueryObserver, type QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_PATHS, type RankingPage } from '../contracts/api.ts'
import { DEFAULT_MATCH_CONFIG } from '../contracts/match.ts'
import { getRequestLog } from '../mocks/requestLog.ts'
import { setScenario } from '../mocks/scenario.ts'
import { server } from '../mocks/server.ts'
import { setupMockServer } from '../mocks/testing.ts'
import { call, makeSubmission } from '../mocks/testUtils.ts'
import { postMatch } from './endpoints.ts'
import { isApiError } from './errors.ts'
import { enqueueMatch } from './outbox.ts'
import {
  HISTORY_ROOT_KEY,
  RANKING_ROOT_KEY,
  historyQueryKey,
  historyQueryOptions,
  invalidateMatchQueries,
  rankingQueryKey,
  rankingQueryOptions,
} from './queries.ts'
import { createQueryClient, queryClient, retryDelayMs } from './queryClient.ts'
import { setRuntimeOptions } from './runtimeOptions.ts'

setupMockServer()

const PLAYER = 'player-test-0001'
const gets = (path: string) =>
  getRequestLog().filter((r) => r.method === 'GET' && r.path.startsWith(path)).length

const clients: QueryClient[] = []
function newClient(): QueryClient {
  const client = createQueryClient()
  client.mount() // what QueryClientProvider does: wires focus and online events
  clients.push(client)
  return client
}
const unsubscribers: (() => void)[] = []

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  for (const client of clients.splice(0)) {
    client.unmount()
    client.clear()
  }
  focusManager.setFocused(undefined)
})

function watchRanking(client: QueryClient, page = 1, pageSize = 50, config = DEFAULT_MATCH_CONFIG) {
  const observer = new QueryObserver(client, rankingQueryOptions(config, page, pageSize))
  const totals: (number | undefined)[] = []
  unsubscribers.push(observer.subscribe((result) => totals.push(result.data?.total)))
  return { observer, totals }
}

describe('query keys', () => {
  it('contain every request parameter', () => {
    expect(rankingQueryKey(DEFAULT_MATCH_CONFIG, 2, 25)).toEqual([
      'ranking',
      { sessionSeconds: 90, spawnIntervalMs: 3000 },
      2,
      25,
    ])
    expect(historyQueryKey(PLAYER, 3, 5)).toEqual(['history', PLAYER, 3, 5])
    const keys = new Set([
      JSON.stringify(rankingQueryKey(DEFAULT_MATCH_CONFIG, 1, 10)),
      JSON.stringify(rankingQueryKey(DEFAULT_MATCH_CONFIG, 2, 10)),
      JSON.stringify(rankingQueryKey(DEFAULT_MATCH_CONFIG, 1, 20)),
      JSON.stringify(rankingQueryKey({ ...DEFAULT_MATCH_CONFIG, sessionSeconds: 60 }, 1, 10)),
      JSON.stringify(rankingQueryKey({ ...DEFAULT_MATCH_CONFIG, spawnIntervalMs: 2000 }, 1, 10)),
    ])
    expect(keys.size).toBe(5)
    expect(rankingQueryKey(DEFAULT_MATCH_CONFIG, 1, 10)[0]).toBe(RANKING_ROOT_KEY[0])
    expect(historyQueryKey(PLAYER, 1, 10)[0]).toBe(HISTORY_ROOT_KEY[0])
  })

  it('ignore object identity: the same config values share one cache entry', async () => {
    const client = newClient()
    await client.fetchQuery(rankingQueryOptions({ ...DEFAULT_MATCH_CONFIG }, 1, 10))
    expect(
      client.getQueryData(rankingQueryOptions({ ...DEFAULT_MATCH_CONFIG }, 1, 10).queryKey),
    ).toBeDefined()
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  })
})

describe('loading, data and background refetch', () => {
  it('loads a page, then refetches in the background keeping the data visible', async () => {
    const client = newClient()
    const { observer } = watchRanking(client, 1, 10)
    expect(observer.getCurrentResult().isPending).toBe(true)
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    expect(observer.getCurrentResult().data?.total).toBe(27)

    const refetching = observer.refetch()
    const during = observer.getCurrentResult()
    expect(during.isFetching).toBe(true)
    expect(during.data?.total).toBe(27) // previous data stays visible
    expect(during.isPending).toBe(false)
    await refetching
    expect(observer.getCurrentResult().isFetching).toBe(false)
  })

  it('keeps the previous page as placeholder while the next page loads (same config)', async () => {
    setRuntimeOptions({ latencyMs: 60 })
    const client = newClient()
    const { observer } = watchRanking(client, 1, 10)
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    const page1 = observer.getCurrentResult().data

    observer.setOptions(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 2, 10))
    const during = observer.getCurrentResult()
    expect(during.isPlaceholderData).toBe(true)
    expect(during.data).toBe(page1)
    expect(during.isFetching).toBe(true)
    await vi.waitFor(() => expect(observer.getCurrentResult().isPlaceholderData).toBe(false))
    expect(observer.getCurrentResult().data?.page).toBe(2)
  })

  it('never shows another config or another player as placeholder', async () => {
    setRuntimeOptions({ latencyMs: 60 })
    const client = newClient()
    const { observer } = watchRanking(client, 1, 10)
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    observer.setOptions(rankingQueryOptions({ sessionSeconds: 60, spawnIntervalMs: 3000 }, 1, 10))
    expect(observer.getCurrentResult().data).toBeUndefined()
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.total).toBe(12))

    await postMatch(makeSubmission({ playerId: PLAYER }))
    const history = new QueryObserver(client, historyQueryOptions(PLAYER, 1, 10))
    unsubscribers.push(history.subscribe(() => {}))
    await vi.waitFor(() => expect(history.getCurrentResult().data?.total).toBe(1))
    history.setOptions(historyQueryOptions('player-someone-else', 1, 10))
    expect(history.getCurrentResult().data).toBeUndefined()
  })

  it('refetches whenever a screen mounts again, even with fresh cached data', async () => {
    const client = newClient()
    await client.fetchQuery(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 1, 10))
    expect(gets('/api/ranking')).toBe(1)
    const { observer } = watchRanking(client, 1, 10) // "tab shown again"
    expect(observer.getCurrentResult().data?.total).toBe(27) // cached data shown immediately
    await vi.waitFor(() => expect(gets('/api/ranking')).toBe(2))
  })

  it('refetches when the window regains focus', async () => {
    const client = newClient()
    const { observer } = watchRanking(client, 1, 10)
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    expect(gets('/api/ranking')).toBe(1)
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await vi.waitFor(() => expect(gets('/api/ranking')).toBe(2))
  })
})

describe('retries', () => {
  it('backoff is exponential and capped', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      500, 1000, 2000, 4000, 5000, 5000, 5000,
    ])
  })

  it('retries transient failures with the configured count (?retry=1 -> 2 requests)', async () => {
    setScenario('http_5xx')
    setRuntimeOptions({ retry: 1 })
    const client = newClient()
    const { observer } = watchRanking(client)
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true), {
      timeout: 4_000,
    })
    expect(gets('/api/ranking')).toBe(2)
    const error = observer.getCurrentResult().error
    expect(isApiError(error) && error.kind === 'http' && error.status === 500).toBe(true)
  })

  it('?retry=0 disables retries', async () => {
    setScenario('http_5xx')
    setRuntimeOptions({ retry: 0 })
    const client = newClient()
    const { observer } = watchRanking(client)
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))
    await new Promise((r) => setTimeout(r, 700))
    expect(gets('/api/ranking')).toBe(1)
  })

  it('does not retry 4xx or invalid responses', async () => {
    setRuntimeOptions({ retry: 3 })
    setScenario('http_4xx')
    const client = newClient()
    const { observer } = watchRanking(client)
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))
    await new Promise((r) => setTimeout(r, 700))
    expect(gets('/api/ranking')).toBe(1)

    setScenario('success')
    let served = 0
    server.use(
      http.get(API_PATHS.ranking, () => {
        served += 1
        return HttpResponse.json({ items: 'garbage' })
      }),
    )
    const other = watchRanking(client, 2)
    await vi.waitFor(() => expect(other.observer.getCurrentResult().isError).toBe(true))
    await new Promise((r) => setTimeout(r, 700))
    expect(served).toBe(1)
    const error = other.observer.getCurrentResult().error
    expect(isApiError(error) && error.kind === 'invalid_response').toBe(true)
  })

  it('retries network failures, then recovers when the API comes back', async () => {
    setScenario('network_error')
    setRuntimeOptions({ retry: 2 })
    const client = newClient()
    const { observer } = watchRanking(client)
    await vi.waitFor(() => expect(gets('/api/ranking')).toBe(1))
    setScenario('success')
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true), {
      timeout: 4_000,
    })
    expect(observer.getCurrentResult().data?.total).toBe(27)
    expect(observer.getCurrentResult().isError).toBe(false)
  })

  it('a failed refetch keeps the last good data visible', async () => {
    const client = newClient()
    const { observer } = watchRanking(client)
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
    setScenario('ranking_fails')
    await observer.refetch()
    const result = observer.getCurrentResult()
    expect(result.isError).toBe(true)
    expect(result.data?.total).toBe(27)
  })
})

describe('stale and out-of-order responses', () => {
  it('an older, slower response never overwrites newer data (out_of_order scenario)', async () => {
    setRuntimeOptions({ latencyMs: null }) // real scenario latencies: 900 ms, 600 ms, ...
    setScenario('out_of_order')
    const client = newClient()
    const { observer, totals } = watchRanking(client)

    // Request #0 is in flight and will be answered last, with the 27-entry snapshot it took on arrival.
    await vi.waitFor(() => expect(gets('/api/ranking')).toBe(1))
    // Meanwhile a match is confirmed, which invalidates the ranking: request #1 is faster.
    await postMatch(makeSubmission({ playerId: PLAYER, score: 30 }))
    void invalidateMatchQueries(client)
    await vi.waitFor(() => expect(gets('/api/ranking')).toBe(2))

    await vi.waitFor(() => expect(observer.getCurrentResult().data?.total).toBe(28), {
      timeout: 3_000,
    })
    // Wait past the moment the stale response (900 ms after request #0) would have landed.
    await new Promise((r) => setTimeout(r, 1_100))
    const result = observer.getCurrentResult()
    expect(result.data?.total).toBe(28)
    expect(result.data?.items[0]?.rank).toBe(1)
    expect(result.data?.items[0]?.score).toBe(30)
    // The observer never went back to the stale snapshot.
    expect(totals).not.toContain(27)
    expect(
      client.getQueryData<RankingPage>(rankingQueryKey(DEFAULT_MATCH_CONFIG, 1, 50))?.total,
    ).toBe(28)
  })

  it('a slow response of a previous page does not replace the page now on screen', async () => {
    setRuntimeOptions({ latencyMs: null })
    setScenario('out_of_order')
    const client = newClient()
    const { observer } = watchRanking(client, 1, 10) // request #0: slow (900 ms)
    await vi.waitFor(() => expect(gets('/api/ranking')).toBe(1))
    observer.setOptions(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 2, 10)) // request #1: faster
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.page).toBe(2), {
      timeout: 3_000,
    })
    await new Promise((r) => setTimeout(r, 1_000))
    expect(observer.getCurrentResult().data?.page).toBe(2)
    expect(observer.getCurrentResult().isPlaceholderData).toBe(false)
  })

  it('each cache entry only receives the response of its own key', async () => {
    setRuntimeOptions({ latencyMs: null })
    setScenario('out_of_order')
    const client = newClient()
    const pages = await Promise.all([
      client.fetchQuery(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 1, 10)),
      client.fetchQuery(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 2, 10)),
      client.fetchQuery(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 3, 10)),
    ]) // answered in reverse order
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3])
    expect(
      client.getQueryData<RankingPage>(rankingQueryKey(DEFAULT_MATCH_CONFIG, 1, 10))?.page,
    ).toBe(1)
  })
})

describe('after a match is confirmed', () => {
  it('invalidates both ranking and history so both tabs refresh', async () => {
    const ranking = watchRanking(queryClient, 1, 50)
    const history = new QueryObserver(queryClient, historyQueryOptions(PLAYER, 1, 10))
    unsubscribers.push(history.subscribe(() => {}))
    await vi.waitFor(() => {
      expect(ranking.observer.getCurrentResult().data?.total).toBe(27)
      expect(history.getCurrentResult().data?.total).toBe(0)
    })

    const submission = makeSubmission({ playerId: PLAYER, score: 11 })
    enqueueMatch(submission)

    await vi.waitFor(() => {
      expect(ranking.observer.getCurrentResult().data?.total).toBe(28)
      expect(history.getCurrentResult().data?.total).toBe(1)
    })
    expect(
      ranking.observer.getCurrentResult().data?.items.some((e) => e.matchId === submission.matchId),
    ).toBe(true)
    expect(history.getCurrentResult().data?.items[0]?.matchId).toBe(submission.matchId)
  })

  it('inactive queries are marked stale and refetch on the next mount', async () => {
    const client = newClient()
    await client.fetchQuery(rankingQueryOptions(DEFAULT_MATCH_CONFIG, 1, 50))
    await call('POST', '/api/matches', makeSubmission({ playerId: PLAYER }))
    await invalidateMatchQueries(client)
    const { observer } = watchRanking(client, 1, 50)
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.total).toBe(28))
  })
})
