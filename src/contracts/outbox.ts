import { z } from 'zod'
import { matchSubmissionSchema } from './match.ts'

/**
 * Lifecycle of a finished match on its way to the server.
 *  pending  -> queued locally, not (successfully) sent yet
 *  syncing  -> request in flight
 *  synced   -> server confirmed (record exists exactly once)
 *  failed   -> last attempt failed; stays queued and can be retried
 */
export type SubmissionStatus = 'pending' | 'syncing' | 'synced' | 'failed'

/** Persisted outbox entry (localStorage). Validated on every read. */
export const pendingSubmissionSchema = z.strictObject({
  submission: matchSubmissionSchema,
  attempts: z.number().int().min(0).max(1_000),
  lastError: z.string().max(500).nullable(),
})
export type PendingSubmission = z.infer<typeof pendingSubmissionSchema>

export const pendingOutboxSchema = z.array(pendingSubmissionSchema).max(100)
