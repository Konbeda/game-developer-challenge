import { QueryClient } from '@tanstack/react-query'
import { getQueryRetries } from './client.ts'
import { isApiError } from './errors.ts'

/** 500 ms, 1 s, 2 s, ... capped at 5 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 5_000)
}

/**
 * Defaults for every query of the app:
 *  - retries with exponential backoff, only for transient failures (network, timeout, 5xx, 429);
 *    the count is read at retry time so `?retry=0` / `configureApi` work without a rebuild;
 *  - short staleTime (only de-duplicates bursts), refetch whenever a screen is mounted again (tab
 *    switch) and whenever the window regains focus or the network returns, so Ranking and Match
 *    History are fresh whenever they are shown;
 *  - previous data is kept by the individual queries (`placeholderData`) while a refetch runs.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnMount: 'always',
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
        retry: (failureCount, error) =>
          failureCount < getQueryRetries() && (!isApiError(error) || error.retryable),
        retryDelay: retryDelayMs,
      },
    },
  })
}

/** Shared by the whole app (module-level, so React Strict Mode double mounting reuses it). */
export const queryClient = createQueryClient()
