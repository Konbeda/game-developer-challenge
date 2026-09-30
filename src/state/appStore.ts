import { create } from 'zustand'
import { usePlayerStore } from './playerStore.ts'

export type Screen = 'menu' | 'options' | 'log' | 'game' | 'result'
export type LogTab = 'ranking' | 'history'
/** first = first-visit prompt, edit = "Change name" from the menu. */
export type NameDialogMode = 'closed' | 'first' | 'edit'

interface AppState {
  screen: Screen
  logTab: LogTab
  /** Bumped for every new match so the game screen remounts with a fresh host. */
  matchNonce: number
  nameDialog: NameDialogMode
  go: (screen: Exclude<Screen, 'game' | 'log'>) => void
  openLog: (tab: LogTab) => void
  setLogTab: (tab: LogTab) => void
  /** Starts a new match with the options that are current right now. */
  startMatch: () => void
  openNameDialog: (mode: Exclude<NameDialogMode, 'closed'>) => void
  closeNameDialog: () => void
}

/** Screen navigation and app-level UI state. No routing library: five screens, no deep links. */
export const useAppStore = create<AppState>((set) => ({
  screen: 'menu',
  logTab: 'ranking',
  matchNonce: 0,
  nameDialog: usePlayerStore.getState().hasProfile ? 'closed' : 'first',
  go: (screen) => set({ screen }),
  openLog: (tab) => set({ screen: 'log', logTab: tab }),
  setLogTab: (tab) => set({ logTab: tab }),
  startMatch: () => set((state) => ({ screen: 'game', matchNonce: state.matchNonce + 1 })),
  openNameDialog: (mode) => set({ nameDialog: mode }),
  closeNameDialog: () => set({ nameDialog: 'closed' }),
}))
