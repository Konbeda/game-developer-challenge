import { queryOptions, type QueryClient, type QueryFilters } from '@tanstack/react-query'
import type { MatchConfig } from '../contracts/match.ts'
import { fetchPlayerMatches, fetchRanking } from './endpoints.ts'

/**
 * Query definitions shared by the hooks, the outbox (invalidation) and the tests.
 *
 * Keys contain every parameter of the request, so each (config, page, pageSize) and
 * (playerId, page, pageSize) combination has its own cache entry. A response can therefore only
 * ever be written into the entry of the request that produced it, and TanStack Query drops the
 * result of a request that was cancelled or superseded (see `signal` below): an older, slower
 * response can never overwrite newer data of the same key.
 */
export const RANKING_ROOT_KEY = ['ranking'] as const
export const HISTORY_ROOT_KEY = ['history'] as const

interface RankingKeyConfig {
  sessionSeconds: number
  spawnIntervalMs: number
}

export function rankingQueryKey(config: MatchConfig, page: number, pageSize: number) {
  const configKey: RankingKeyConfig = {
    sessionSeconds: config.sessionSeconds,
    spawnIntervalMs: config.spawnIntervalMs,
  }
  return [...RANKING_ROOT_KEY, configKey, page, pageSize] as const
}

export function historyQueryKey(playerId: string, page: number, pageSize: number) {
  return [...HISTORY_ROOT_KEY, playerId, page, pageSize] as const
}

export function rankingQueryOptions(config: MatchConfig, page: number, pageSize: number) {
  return queryOptions({
    queryKey: rankingQueryKey(config, page, pageSize),
    queryFn: ({ signal }) => fetchRanking(config, page, pageSize, signal),
    // Keep the previous page on screen while another page loads, but never data of another config.
    placeholderData: (previousData, previousQuery) => {
      const previousConfig = previousQuery?.queryKey[1]
      return previousConfig?.sessionSeconds === config.sessionSeconds &&
        previousConfig.spawnIntervalMs === config.spawnIntervalMs
        ? previousData
        : undefined
    },
  })
}

export function historyQueryOptions(playerId: string, page: number, pageSize: number) {
  return queryOptions({
    queryKey: historyQueryKey(playerId, page, pageSize),
    queryFn: ({ signal }) => fetchPlayerMatches(playerId, page, pageSize, signal),
    // Never show another player's history as a placeholder.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === playerId ? previousData : undefined,
  })
}

/**
 * Called after a match is confirmed: both tabs must show the new record.
 *
 * Requests still in flight were answered from data that predates the confirmation, so they are
 * cancelled first (TanStack Query would otherwise reuse an in-flight request that has no data yet
 * instead of starting a new one) and every list is then invalidated: active queries refetch now,
 * inactive ones are marked stale and refetch when their screen mounts.
 */
export async function invalidateMatchQueries(client: QueryClient): Promise<void> {
  const filters: QueryFilters[] = [{ queryKey: RANKING_ROOT_KEY }, { queryKey: HISTORY_ROOT_KEY }]
  await Promise.all(filters.map((filter) => client.cancelQueries(filter)))
  await Promise.all(filters.map((filter) => client.invalidateQueries(filter)))
}
