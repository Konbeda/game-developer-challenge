import type { UseQueryResult } from '@tanstack/react-query'
import type { MatchHistoryPage, RankingPage } from '../contracts/api.ts'
import type { MatchConfig, MatchRecord } from '../contracts/match.ts'
import type { SubmissionStatus } from '../contracts/outbox.ts'
import { LIMITS } from '../config/limits.ts'

// STUB: public signatures agreed between the shell and network work. Owned by the network work,
// which replaces the bodies (TanStack Query + Axios). Do not change signatures without a contract update.

export function useRanking(
  _config: MatchConfig,
  _page: number,
  _pageSize: number = LIMITS.pageSize.default,
): UseQueryResult<RankingPage> {
  throw new Error('Not implemented')
}

export function usePlayerMatches(
  _playerId: string,
  _page: number,
  _pageSize: number = LIMITS.pageSize.default,
): UseQueryResult<MatchHistoryPage> {
  throw new Error('Not implemented')
}

export interface MatchSubmissionState {
  status: SubmissionStatus
  record: MatchRecord | null
  error: string | null
  retry: () => void
}

/** Observes one match in the outbox. `null` matchId -> `null` result. */
export function useMatchSubmission(_matchId: string | null): MatchSubmissionState | null {
  throw new Error('Not implemented')
}
