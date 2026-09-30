import {
  API_PATHS,
  matchHistoryPageSchema,
  rankingPageSchema,
  submitMatchResponseSchema,
  type MatchHistoryPage,
  type RankingPage,
  type SubmitMatchResponse,
} from '../contracts/api.ts'
import type { MatchConfig, MatchSubmission } from '../contracts/match.ts'
import { requestJson } from './client.ts'

/** Typed wrappers over the REST contract. All of them reject only with `ApiError`. */

export function fetchRanking(
  config: MatchConfig,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<RankingPage> {
  return requestJson(
    {
      method: 'GET',
      url: API_PATHS.ranking,
      params: {
        sessionSeconds: config.sessionSeconds,
        spawnIntervalMs: config.spawnIntervalMs,
        page,
        pageSize,
      },
      ...(signal ? { signal } : {}),
    },
    rankingPageSchema,
  )
}

export function fetchPlayerMatches(
  playerId: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<MatchHistoryPage> {
  return requestJson(
    {
      method: 'GET',
      url: API_PATHS.playerMatches(playerId),
      params: { page, pageSize },
      ...(signal ? { signal } : {}),
    },
    matchHistoryPageSchema,
  )
}

/** POST /api/matches. 201 (created) and 200 (duplicate) both resolve; see `duplicate`. */
export function postMatch(
  submission: MatchSubmission,
  signal?: AbortSignal,
): Promise<SubmitMatchResponse> {
  return requestJson(
    {
      method: 'POST',
      url: API_PATHS.matches,
      data: submission,
      ...(signal ? { signal } : {}),
    },
    submitMatchResponseSchema,
  )
}
