import { create } from 'zustand'
import { DEFAULT_MATCH_CONFIG, matchConfigSchema } from '../contracts/match.ts'
import type { MatchConfig } from '../contracts/match.ts'
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage.ts'

interface OptionsState {
  /** Saved options. Each match takes a snapshot of this value when it starts. */
  config: MatchConfig
  /**
   * Validates and saves. Returns `persisted: false` when the value is only kept for this
   * session (storage unavailable) and `valid: false` when the schema rejected it.
   */
  save: (next: MatchConfig) => { valid: boolean; persisted: boolean }
}

/** Player-tunable match options (README section 3). Validated by the shared schema on every read. */
export const useOptionsStore = create<OptionsState>((set) => ({
  config: readStorage(STORAGE_KEYS.options, matchConfigSchema, DEFAULT_MATCH_CONFIG),
  save: (next) => {
    const parsed = matchConfigSchema.safeParse(next)
    if (!parsed.success) return { valid: false, persisted: false }
    const persisted = writeStorage(STORAGE_KEYS.options, parsed.data)
    set({ config: parsed.data })
    return { valid: true, persisted }
  },
}))
