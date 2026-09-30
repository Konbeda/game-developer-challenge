import { LIMITS } from '../config/limits.ts'
import { matchConfigSchema } from '../contracts/match.ts'
import type { MatchConfig } from '../contracts/match.ts'

/** Pure helpers behind the Options screen: text <-> MatchConfig, stepping and validation. */

const SESSION_STEP_SECONDS = 5
const SPAWN_STEP_MS = LIMITS.spawnIntervalMs.step

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** What the two inputs currently contain (raw text, so half-typed values survive). */
export interface OptionsDraft {
  sessionSeconds: string
  spawnSeconds: string
}

export interface OptionsErrors {
  sessionSeconds?: string
  spawnSeconds?: string
}

const seconds = (ms: number) => String(ms / 1000)

/** Seconds shown to the player for a millisecond value: 3000 -> "3", 2500 -> "2.5". */
export function formatSeconds(ms: number): string {
  return seconds(ms)
}

export function configToDraft(config: MatchConfig): OptionsDraft {
  return {
    sessionSeconds: String(config.sessionSeconds),
    spawnSeconds: formatSeconds(config.spawnIntervalMs),
  }
}

export function parseSessionSeconds(raw: string): FieldResult<number> {
  const { min, max } = LIMITS.sessionSeconds
  const text = raw.trim()
  if (text === '') return { ok: false, error: `Enter a time between ${min} and ${max} seconds.` }
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Use whole seconds, for example 90.' }
  const value = Number(text)
  if (value < min || value > max) {
    return { ok: false, error: `Session time must be between ${min} and ${max} seconds.` }
  }
  return { ok: true, value }
}

/** Parses seconds (one decimal allowed) and returns the value in milliseconds. */
export function parseSpawnSeconds(raw: string): FieldResult<number> {
  const { min, max } = LIMITS.spawnIntervalMs
  const text = raw.trim().replace(',', '.')
  if (text === '') {
    return { ok: false, error: `Enter a time between ${seconds(min)} and ${seconds(max)} seconds.` }
  }
  if (!/^\d+(\.\d?)?$/.test(text)) {
    return { ok: false, error: 'Use seconds in steps of 0.1, for example 2.5.' }
  }
  const ms = Math.round(Number(text) * 10) * SPAWN_STEP_MS
  if (ms < min || ms > max) {
    return {
      ok: false,
      error: `Spawn time must be between ${seconds(min)} and ${seconds(max)} seconds.`,
    }
  }
  return { ok: true, value: ms }
}

export type DraftValidation =
  { ok: true; config: MatchConfig } | { ok: false; errors: OptionsErrors }

/** Validates both fields; the resulting config is also checked against the shared schema. */
export function validateDraft(draft: OptionsDraft): DraftValidation {
  const session = parseSessionSeconds(draft.sessionSeconds)
  const spawn = parseSpawnSeconds(draft.spawnSeconds)
  const errors: OptionsErrors = {}
  if (!session.ok) errors.sessionSeconds = session.error
  if (!spawn.ok) errors.spawnSeconds = spawn.error
  if (!session.ok || !spawn.ok) return { ok: false, errors }
  const parsed = matchConfigSchema.safeParse({
    sessionSeconds: session.value,
    spawnIntervalMs: spawn.value,
  })
  if (!parsed.success)
    return { ok: false, errors: { spawnSeconds: 'These options are not valid.' } }
  return { ok: true, config: parsed.data }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Next session time (text) after pressing + / -. Invalid text steps from the default. */
export function stepSessionSeconds(raw: string, direction: 1 | -1): string {
  const { min, max, default: fallback } = LIMITS.sessionSeconds
  const parsed = parseSessionSeconds(raw)
  const current = parsed.ok ? parsed.value : fallback
  return String(clamp(current + direction * SESSION_STEP_SECONDS, min, max))
}

/** Next spawn time (text) after pressing + / -. Steps of 0.1 s. */
export function stepSpawnSeconds(raw: string, direction: 1 | -1): string {
  const { min, max, default: fallback } = LIMITS.spawnIntervalMs
  const parsed = parseSpawnSeconds(raw)
  const current = parsed.ok ? parsed.value : fallback
  return formatSeconds(clamp(current + direction * SPAWN_STEP_MS, min, max))
}

export function canStepSession(raw: string, direction: 1 | -1): boolean {
  const parsed = parseSessionSeconds(raw)
  if (!parsed.ok) return true
  return direction === 1
    ? parsed.value < LIMITS.sessionSeconds.max
    : parsed.value > LIMITS.sessionSeconds.min
}

export function canStepSpawn(raw: string, direction: 1 | -1): boolean {
  const parsed = parseSpawnSeconds(raw)
  if (!parsed.ok) return true
  return direction === 1
    ? parsed.value < LIMITS.spawnIntervalMs.max
    : parsed.value > LIMITS.spawnIntervalMs.min
}
