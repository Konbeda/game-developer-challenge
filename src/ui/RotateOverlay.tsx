import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { pushModal } from './primitives/index.ts'
import { usePortraitPhone } from './lib/media.ts'

/**
 * Full-screen "rotate your device" notice for phones held upright. It only covers and disables
 * the UI (inert app root); nothing is unmounted, so state survives, and a running match has
 * already been auto-paused by the game screen.
 */
export function RotateOverlay() {
  const portrait = usePortraitPhone()

  useEffect(() => {
    if (!portrait) return
    return pushModal().release
  }, [portrait])

  if (!portrait) return null
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rotate-title"
      aria-describedby="rotate-text"
      data-testid="rotate-overlay"
      className="fixed inset-0 z-[100] grid place-items-center bg-[#0b1a2b] p-6 text-center"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="rotate-phone" aria-hidden="true" />
        <h2
          id="rotate-title"
          className="font-display text-2xl font-semibold tracking-wide text-cream uppercase"
        >
          Rotate your device
        </h2>
        <p id="rotate-text" className="max-w-[26ch] text-cream-dim">
          Pirate Battle is played in landscape. Your game is paused until you turn the screen.
        </p>
      </div>
    </div>,
    document.body,
  )
}
