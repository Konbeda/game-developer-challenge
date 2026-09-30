import { z } from 'zod'
import { matchConfigSchema, matchRecordSchema, rankingEntrySchema } from './match.ts'
import { idSchema, pageParamSchema, pageSizeParamSchema } from './primitives.ts'

/**
 * REST contract (served by MSW):
 *
 *   GET  /api/ranking?sessionSeconds&spawnIntervalMs&page&pageSize
 *        -> Page<RankingEntry>, only matches with the same config, ordered by compareRanking
 *   GET  /api/players/:playerId/matches?page&pageSize
 *        -> Page<MatchRecord>, newest first (playedAt desc, matchId desc)
 *   POST /api/matches   (body: MatchSubmission)
 *        -> 201 { record, duplicate: false } when created
 *        -> 200 { record, duplicate: true }  when matchId already exists (idempotent)
 *        -> 400 validation error, 409 same matchId with a DIFFERENT payload
 *   Errors: { error: { code, message } }
 */
export const API_PATHS = {
  ranking: '/api/ranking',
  playerMatches: (playerId: string) => `/api/players/${encodeURIComponent(playerId)}/matches`,
  playerMatchesPattern: '/api/players/:playerId/matches',
  matches: '/api/matches',
} as const

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })

export const rankingPageSchema = pageSchema(rankingEntrySchema)
export type RankingPage = z.infer<typeof rankingPageSchema>

export const matchHistoryPageSchema = pageSchema(matchRecordSchema)
export type MatchHistoryPage = z.infer<typeof matchHistoryPageSchema>

/** Query strings arrive as text, so numbers are coerced before the strict checks. */
export const rankingQuerySchema = z.strictObject({
  sessionSeconds: z.coerce.number().pipe(matchConfigSchema.shape.sessionSeconds),
  spawnIntervalMs: z.coerce.number().pipe(matchConfigSchema.shape.spawnIntervalMs),
  page: pageParamSchema.default(1),
  pageSize: pageSizeParamSchema.default(10),
})
export type RankingQuery = z.infer<typeof rankingQuerySchema>

export const playerMatchesParamsSchema = z.strictObject({ playerId: idSchema })
export const paginationQuerySchema = z.strictObject({
  page: pageParamSchema.default(1),
  pageSize: pageSizeParamSchema.default(10),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const submitMatchResponseSchema = z.strictObject({
  record: matchRecordSchema,
  duplicate: z.boolean(),
})
export type SubmitMatchResponse = z.infer<typeof submitMatchResponseSchema>

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.string().max(64), message: z.string().max(500) }),
})
export type ApiErrorBody = z.infer<typeof apiErrorSchema>
