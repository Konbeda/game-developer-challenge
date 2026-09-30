import type { z } from 'zod'

/** Every localStorage key used by the app. Keep them namespaced and listed here. */
export const STORAGE_KEYS = {
  options: 'pirate-battle:options',
  player: 'pirate-battle:player',
  lastResult: 'pirate-battle:last-result',
  outbox: 'pirate-battle:outbox',
  outboxSynced: 'pirate-battle:outbox-synced',
  mockDb: 'pirate-battle:mock-db',
  mockScenario: 'pirate-battle:mock-scenario',
  muted: 'pirate-battle:muted',
} as const

/**
 * Reads and validates a value. Missing, unparsable, tampered or throwing storage all
 * resolve to `fallback`; the app must never trust what is in localStorage.
 */
export function readStorage<S extends z.ZodType>(
  key: string,
  schema: S,
  fallback: z.infer<S>,
): z.infer<S> {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : fallback
  } catch {
    return fallback
  }
}

/** Returns false when the value could not be persisted (quota, private mode). */
export function writeStorage(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // storage unavailable: nothing to remove
  }
}
