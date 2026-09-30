import { matchSubmissionSchema } from '../contracts/match.ts'
import type { MatchResult, MatchSubmission } from '../contracts/match.ts'
import type { MatchSettings } from '../game/contracts.ts'
import { createId } from './ids.ts'

export interface PlayerIdentity {
  playerId: string
  playerName: string
}

export interface BuildSubmissionInput {
  result: MatchResult
  settings: MatchSettings
  player: PlayerIdentity
  /** Injectable for tests. */
  now?: Date
  newId?: () => string
}

export type BuildSubmissionResult =
  { ok: true; submission: MatchSubmission } | { ok: false; error: string }

/**
 * Turns what the simulation reported into the body of POST /api/matches. `matchId` is created
 * here, once, at match end: it is what makes retries idempotent. The result is validated with
 * the shared schema so nothing malformed is ever queued or persisted.
 */
export function buildSubmission({
  result,
  settings,
  player,
  now = new Date(),
  newId = createId,
}: BuildSubmissionInput): BuildSubmissionResult {
  const parsed = matchSubmissionSchema.safeParse({
    matchId: newId(),
    playerId: player.playerId,
    playerName: player.playerName,
    playedAt: now.toISOString(),
    score: Math.round(result.score),
    durationMs: Math.round(result.durationMs),
    endReason: result.endReason,
    config: settings.config,
    seed: settings.seed,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid match data' }
  }
  return { ok: true, submission: parsed.data }
}
