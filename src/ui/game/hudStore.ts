import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { HudState, MatchPhase } from '../../game/contracts.ts'

/**
 * What the React HUD renders. Derived from the host's HudState on change only: the timer is
 * reduced to whole seconds, so even a host that emits often re-renders the clock once per second.
 */
export interface HudView {
  phase: MatchPhase
  score: number
  seconds: number
  health: number
  maxHealth: number
}

export const INITIAL_HUD_VIEW: HudView = {
  phase: 'idle',
  score: 0,
  seconds: 0,
  health: 0,
  maxHealth: 0,
}

export function toHudView(hud: HudState): HudView {
  return {
    phase: hud.phase,
    score: hud.score,
    seconds: Math.max(0, Math.ceil(hud.timeRemainingMs / 1000)),
    health: Math.max(0, Math.ceil(hud.playerHealth)),
    maxHealth: Math.max(0, Math.ceil(hud.playerMaxHealth)),
  }
}

export type HudStore = StoreApi<HudView>

export function createHudStore(): HudStore {
  return createStore<HudView>(() => INITIAL_HUD_VIEW)
}

/** Writes a host update into the store; a no-op when nothing visible changed. */
export function applyHud(store: HudStore, hud: HudState): void {
  const next = toHudView(hud)
  const current = store.getState()
  if (
    current.phase === next.phase &&
    current.score === next.score &&
    current.seconds === next.seconds &&
    current.health === next.health &&
    current.maxHealth === next.maxHealth
  ) {
    return
  }
  store.setState(next)
}

export const HudStoreContext = createContext<HudStore | null>(null)

/** Subscribes a component to one slice of the HUD; it re-renders only when that slice changes. */
export function useHud<T>(selector: (view: HudView) => T): T {
  const store = useContext(HudStoreContext)
  if (!store) throw new Error('useHud must be used inside a HudStoreContext provider')
  return useStore(store, selector)
}
