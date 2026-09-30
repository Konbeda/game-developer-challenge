import { useSyncExternalStore } from 'react'
import {
  canControlFullscreen,
  enterLandscapeFullscreen,
  isFullscreen,
  leaveFullscreen,
  subscribeFullscreen,
} from '../lib/fullscreen.ts'
import { IconButton } from '../primitives/index.ts'

function Corners({ active }: { active: boolean }) {
  // Four corner brackets pointing outwards (enter fullscreen) or inwards (leave it).
  const d = active
    ? 'M9 4v3a2 2 0 0 1-2 2H4m16 0h-3a2 2 0 0 1-2-2V4m0 16v-3a2 2 0 0 1 2-2h3M4 15h3a2 2 0 0 1 2 2v3'
    : 'M4 9V6a2 2 0 0 1 2-2h3m6 0h3a2 2 0 0 1 2 2v3m0 6v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3'
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="#ffe9b9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Fullscreen + landscape on/off for phones. Shown only on real touch devices whose browser supports the
 * Fullscreen API (Chrome on Android; iPhone Safari does not), so it never appears where it cannot work.
 */
export function FullscreenToggle({ size }: { size?: 'sm' | 'md' | 'lg' }) {
  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false)
  if (!canControlFullscreen()) return null
  return (
    <IconButton
      glyph={<Corners active={fullscreen} />}
      label="Fullscreen"
      aria-pressed={fullscreen}
      title={fullscreen ? 'Leave fullscreen' : 'Fullscreen, landscape'}
      onClick={() => void (fullscreen ? leaveFullscreen() : enterLandscapeFullscreen())}
      data-testid="fullscreen-toggle"
      {...(size ? { size } : {})}
    />
  )
}
