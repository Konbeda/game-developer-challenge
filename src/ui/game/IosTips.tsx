import { isIos, isStandalone, needsIosTips } from '../lib/fullscreen.ts'

/**
 * iPhone Safari gives pages no fullscreen and no orientation lock, so the buttons other phones get are
 * replaced by two honest tips: how to install the game as a web app (fullscreen, no browser bars) and
 * how to let the phone turn. Rendered only on iOS.
 */
export function IosInstallTip() {
  if (!needsIosTips()) return null
  return (
    <p
      data-testid="ios-install-tip"
      className="rounded-field bg-board-deep/60 px-3 py-2 text-xs text-cream-dim"
    >
      <span className="font-bold text-cream">Fullscreen on iPhone:</span> tap Share, then{' '}
      <span className="font-bold text-cream">Add to Home Screen</span>, and open Pirate Battle from
      there.
    </p>
  )
}

/** Extra lines for the rotate notice on iOS, where the page cannot turn the screen itself. */
export function IosRotateHint() {
  if (!isIos()) return null
  return (
    <>
      <p data-testid="ios-rotate-hint" className="max-w-[28ch] text-sm text-cream-dim">
        Still upright? Turn off{' '}
        <span className="font-bold text-cream">Portrait Orientation Lock</span> in Control Center.
      </p>
      {isStandalone() ? null : (
        <p className="max-w-[28ch] text-sm text-cream-dim">
          For fullscreen: Share, then{' '}
          <span className="font-bold text-cream">Add to Home Screen</span>.
        </p>
      )}
    </>
  )
}
