import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { MatchHistoryPage, RankingPage } from '../contracts/api.ts'
import type { MatchConfig, MatchRecord } from '../contracts/match.ts'
import type { SubmissionStatus } from '../contracts/outbox.ts'
import { LIMITS } from '../config/limits.ts'
import { getSubmissionView, retryMatch, subscribeOutbox } from './outbox.ts'
import { historyQueryOptions, rankingQueryOptions } from './queries.ts'

/**
 * Ranking of one config, one page. `isFetching` is true during background refetches while the
 * previous data stays visible (`data` is kept across page changes of the same config).
 */
export function useRanking(
  config: MatchConfig,
  page: number,
  pageSize: number = LIMITS.pageSize.default,
): UseQueryResult<RankingPage> {
  return useQuery(rankingQueryOptions(config, page, pageSize))
}

/** Match history of one player, newest first, one page. */
export function usePlayerMatches(
  playerId: string,
  page: number,
  pageSize: number = LIMITS.pageSize.default,
): UseQueryResult<MatchHistoryPage> {
  return useQuery(historyQueryOptions(playerId, page, pageSize))
}

export interface MatchSubmissionState {
  status: SubmissionStatus
  record: MatchRecord | null
  error: string | null
  retry: () => void
}

/**
 * Observes one match in the outbox. `null` matchId -> `null` result. Also `null` when the outbox
 * does not know the match (never enqueued, or cleared by `resetMocks`). Re-renders only when the
 * state of this match changes.
 */
export function useMatchSubmission(matchId: string | null): MatchSubmissionState | null {
  const view = useSyncExternalStore(
    subscribeOutbox,
    () => getSubmissionView(matchId),
    () => null,
  )
  const retry = useCallback(() => {
    if (matchId !== null) retryMatch(matchId)
  }, [matchId])
  return useMemo(
    () => (view ? { status: view.status, record: view.record, error: view.error, retry } : null),
    [view, retry],
  )
}
