import type { MatchSubmission } from '../contracts/match.ts'
import { postMatch } from './endpoints.ts'
import { createOutbox, type SubmissionView } from './outboxCore.ts'
import { queryClient } from './queryClient.ts'
import { invalidateMatchQueries } from './queries.ts'

/**
 * App-wide outbox: real HTTP (Axios, so MSW in dev/test/demo) + TanStack Query invalidation.
 * The state machine and persistence live in `outboxCore.ts`.
 */
const outbox = createOutbox({
  send: (submission, signal) => postMatch(submission, signal),
  // A confirmed match changes both lists: refresh Ranking and Match History.
  onSynced: () => {
    void invalidateMatchQueries(queryClient)
  },
})

/** Queues a finished match (persisted) and starts sending it. Idempotent per matchId. Never throws. */
export function enqueueMatch(submission: MatchSubmission): void {
  outbox.enqueue(submission)
}

/** Manual retry of a queued match. */
export function retryMatch(matchId: string): void {
  outbox.retry(matchId)
}

/** Sends everything left in the persisted outbox (call once on app start and when back online). */
export function flushPending(): void {
  void outbox.flush()
}

/** Same as `flushPending` but resolves when every attempt has settled (tests, tooling). */
export function flushPendingAndWait(): Promise<void> {
  return outbox.flush()
}

/** `useSyncExternalStore` plumbing for `useMatchSubmission`. */
export function subscribeOutbox(listener: () => void): () => void {
  return outbox.subscribe(listener)
}

export function getSubmissionView(matchId: string | null): SubmissionView | null {
  return outbox.getSnapshot(matchId)
}

/** Drops every queued and remembered submission (part of `resetMocks`). */
export function resetOutbox(): void {
  outbox.reset()
}
