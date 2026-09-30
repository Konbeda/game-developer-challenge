import type { MatchSubmission } from '../contracts/match.ts'

// STUB: owned by the network work. Non-hook API, callable from the game end handler.

/** Queues a finished match (persisted) and starts sending it. Idempotent per matchId. Never throws. */
export function enqueueMatch(_submission: MatchSubmission): void {
  throw new Error('Not implemented')
}

/** Manual retry of a queued match. */
export function retryMatch(_matchId: string): void {
  throw new Error('Not implemented')
}

/** Sends everything left in the persisted outbox (call once on app start and when back online). */
export function flushPending(): void {
  throw new Error('Not implemented')
}
