import { useSyncExternalStore } from 'react'

/** Subscribes to a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** `?touch=1` forces the on-screen controls (used by tests and for demos on desktop). */
export function isTouchForced(): boolean {
  return new URLSearchParams(window.location.search).get('touch') === '1'
}

/** True on coarse-pointer devices or when forced by `?touch=1`. */
export function useTouchControls(): boolean {
  const coarse = useMediaQuery('(pointer: coarse)')
  return coarse || isTouchForced()
}

/** Phone held upright: the game is landscape only, so the UI asks for a rotation. */
export function usePortraitPhone(): boolean {
  const portrait = useMediaQuery('(orientation: portrait) and (max-width: 900px)')
  const touch = useTouchControls()
  return portrait && touch
}
