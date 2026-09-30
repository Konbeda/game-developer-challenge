import { z } from 'zod'
import { LIMITS } from '../config/limits.ts'
import { idSchema, playerNameSchema } from '../contracts/primitives.ts'

/** Persisted player identity (STORAGE_KEYS.player). No login: the id is local and random. */
export const storedPlayerSchema = z.strictObject({
  playerId: idSchema,
  playerName: playerNameSchema,
})
export type StoredPlayer = z.infer<typeof storedPlayerSchema>

export type NameValidation = { ok: true; value: string } | { ok: false; error: string }

/** Validates a typed name with the shared allowlist schema and returns a friendly message. */
export function validatePlayerName(raw: string): NameValidation {
  const collapsed = raw.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')
  if (collapsed.length === 0) {
    return {
      ok: false,
      error: `Enter a name (${LIMITS.playerName.min}-${LIMITS.playerName.max} characters).`,
    }
  }
  if (collapsed.length > LIMITS.playerName.max) {
    return { ok: false, error: `Name is too long (${LIMITS.playerName.max} characters at most).` }
  }
  const parsed = playerNameSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Use letters, numbers, spaces, "_" or "-" only.' }
  }
  return { ok: true, value: parsed.data }
}
