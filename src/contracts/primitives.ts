import { z } from 'zod'
import { LIMITS } from '../config/limits.ts'

/**
 * Allowlist for the player name: letters, digits, `_` and `-`, words separated by single spaces.
 * Anything else (markup, control chars, unicode tricks) is rejected, not sanitised.
 */
export const PLAYER_NAME_REGEX = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/

export const playerNameSchema = z
  .string()
  // Only plain spaces are normalised; tabs, newlines and other whitespace fail the allowlist below.
  .transform((value) => value.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' '))
  .pipe(
    z
      .string()
      .min(LIMITS.playerName.min)
      .max(LIMITS.playerName.max)
      .regex(PLAYER_NAME_REGEX, 'Use letters, numbers, spaces, "_" or "-" only'),
  )

/** Opaque identifiers (match, player). Strict charset, bounded length. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid identifier')

export const isoDateSchema = z.iso.datetime({ offset: false })

export const pageParamSchema = z.coerce.number().int().min(1).max(LIMITS.maxPage)
export const pageSizeParamSchema = z.coerce
  .number()
  .int()
  .min(LIMITS.pageSize.min)
  .max(LIMITS.pageSize.max)
