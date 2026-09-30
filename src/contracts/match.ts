import { z } from 'zod'
import { LIMITS } from '../config/limits.ts'
import { idSchema, isoDateSchema, playerNameSchema } from './primitives.ts'

/** The two player-tunable options. Matches are only comparable when this is equal. */
export const matchConfigSchema = z.strictObject({
  sessionSeconds: z.number().int().min(LIMITS.sessionSeconds.min).max(LIMITS.sessionSeconds.max),
  spawnIntervalMs: z
    .number()
    .int()
    .min(LIMITS.spawnIntervalMs.min)
    .max(LIMITS.spawnIntervalMs.max)
    .refine(
      (v) => v % LIMITS.spawnIntervalMs.step === 0,
      'Spawn interval must be a multiple of 100 ms',
    ),
})
export type MatchConfig = z.infer<typeof matchConfigSchema>

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  sessionSeconds: LIMITS.sessionSeconds.default,
  spawnIntervalMs: LIMITS.spawnIntervalMs.default,
}

export const endReasonSchema = z.enum(['time_up', 'player_destroyed'])
export type EndReason = z.infer<typeof endReasonSchema>

/** What the simulation reports when a match ends. */
export interface MatchResult {
  score: number
  /** Effective active play time in ms (paused time excluded). */
  durationMs: number
  endReason: EndReason
}

/**
 * Upper bound of the score a match could legitimately reach: enemies spawn every
 * `spawnIntervalMs` (first one at t = interval) and each is worth 1 point.
 */
export function maxPlausibleScore(config: MatchConfig, durationMs: number): number {
  return Math.floor(durationMs / config.spawnIntervalMs)
}

/**
 * Body of POST /api/matches. `matchId` is generated client-side when the match ends and makes
 * the submission idempotent. Contains everything a server would need to replay the match.
 */
export const matchSubmissionSchema = z
  .strictObject({
    matchId: idSchema,
    playerId: idSchema,
    playerName: playerNameSchema,
    playedAt: isoDateSchema,
    score: z.number().int().min(0).max(10_000),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(LIMITS.sessionSeconds.max * 1000 + LIMITS.durationToleranceMs),
    endReason: endReasonSchema,
    config: matchConfigSchema,
    seed: z.number().int().min(0).max(0xffff_ffff),
  })
  .superRefine((m, ctx) => {
    const limitMs = m.config.sessionSeconds * 1000
    if (m.durationMs > limitMs + LIMITS.durationToleranceMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Duration exceeds session time',
      })
    }
    if (m.endReason === 'time_up' && m.durationMs < limitMs - LIMITS.durationToleranceMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationMs'],
        message: 'Match ended early for time_up',
      })
    }
    if (m.score > maxPlausibleScore(m.config, m.durationMs)) {
      ctx.addIssue({ code: 'custom', path: ['score'], message: 'Implausible score' })
    }
  })
export type MatchSubmission = z.infer<typeof matchSubmissionSchema>

/** A submission the server has confirmed. */
export const matchRecordSchema = z.strictObject({
  matchId: idSchema,
  playerId: idSchema,
  playerName: playerNameSchema,
  playedAt: isoDateSchema,
  score: z.number().int().min(0).max(10_000),
  durationMs: z.number().int().min(0),
  endReason: endReasonSchema,
  config: matchConfigSchema,
  seed: z.number().int().min(0).max(0xffff_ffff),
  recordedAt: isoDateSchema,
})
export type MatchRecord = z.infer<typeof matchRecordSchema>

export const rankingEntrySchema = z.strictObject({
  rank: z.number().int().min(1),
  matchId: idSchema,
  playerId: idSchema,
  playerName: playerNameSchema,
  score: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  playedAt: isoDateSchema,
  config: matchConfigSchema,
})
export type RankingEntry = z.infer<typeof rankingEntrySchema>

type RankingKey = Pick<RankingEntry, 'score' | 'durationMs' | 'playedAt' | 'matchId'>

/**
 * Deterministic ranking order: score desc, duration asc (faster wins), playedAt asc, matchId asc.
 * Shared by the MSW handlers and the tests.
 */
export function compareRanking(a: RankingKey, b: RankingKey): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs
  if (a.playedAt !== b.playedAt) return a.playedAt < b.playedAt ? -1 : 1
  return a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0
}

export function sameConfig(a: MatchConfig, b: MatchConfig): boolean {
  return a.sessionSeconds === b.sessionSeconds && a.spawnIntervalMs === b.spawnIntervalMs
}
