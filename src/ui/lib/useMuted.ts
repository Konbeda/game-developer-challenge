import { useSyncExternalStore } from 'react'
import { audio } from '../../game/audio/audio.ts'

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Mute preference of the shared audio engine (persisted by the engine itself). */
export function useMuted(): { muted: boolean; toggle: () => void } {
  const muted = useSyncExternalStore(
    subscribe,
    () => audio.isMuted(),
    () => false,
  )
  const toggle = () => {
    audio.setMuted(!audio.isMuted())
    listeners.forEach((listener) => listener())
  }
  return { muted, toggle }
}
