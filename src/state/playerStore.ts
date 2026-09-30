import { create } from 'zustand'
import { DEFAULT_PLAYER_NAME } from '../config/limits.ts'
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage.ts'
import { createId } from './ids.ts'
import { storedPlayerSchema, validatePlayerName } from './player.ts'
import type { StoredPlayer } from './player.ts'

interface PlayerState extends StoredPlayer {
  /** False until the player confirmed or skipped the name prompt once (first visit). */
  hasProfile: boolean
  /** Validates and persists a new name. Returns an error message, or null on success. */
  setName: (raw: string) => string | null
  /** Keeps the current (default) name and remembers that the prompt was answered. */
  keepName: () => void
}

function loadInitial(): Pick<PlayerState, 'playerId' | 'playerName' | 'hasProfile'> {
  const stored = readStorage(STORAGE_KEYS.player, storedPlayerSchema.nullable(), null)
  if (stored) return { ...stored, hasProfile: true }
  return { playerId: createId(), playerName: DEFAULT_PLAYER_NAME, hasProfile: false }
}

function persist(player: StoredPlayer): void {
  writeStorage(STORAGE_KEYS.player, { playerId: player.playerId, playerName: player.playerName })
}

/** Local player identity (no login). Persisted with the shared schema, validated on read. */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  ...loadInitial(),
  setName: (raw) => {
    const result = validatePlayerName(raw)
    if (!result.ok) return result.error
    const next = { playerId: get().playerId, playerName: result.value }
    persist(next)
    set({ ...next, hasProfile: true })
    return null
  },
  keepName: () => {
    persist(get())
    set({ hasProfile: true })
  },
}))
