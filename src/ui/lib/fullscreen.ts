/**
 * Phones show the browser's address bar, which steals a lot of height in landscape. Starting a match on
 * a real touch device therefore asks for fullscreen (and a landscape lock, which browsers only allow
 * while fullscreen). Both need a user gesture, so this is called straight from the Play button's click.
 * Everything is best effort: unsupported browsers (iPhone Safari) or a refusal just keep the page as is.
 */
export interface FullscreenEnv {
  /** A real touch screen as primary pointer (not the `?touch=1` demo switch). */
  coarsePointer: boolean
  /** `document.fullscreenEnabled`. */
  supported: boolean
  /** Driven by WebDriver (tests): never change the window under an automated run. */
  automated: boolean
  alreadyFullscreen: boolean
}

export function shouldEnterFullscreen(env: FullscreenEnv): boolean {
  return env.coarsePointer && env.supported && !env.automated && !env.alreadyFullscreen
}

function readEnv(): FullscreenEnv {
  return {
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    supported: Boolean(document.fullscreenEnabled),
    automated: Boolean(navigator.webdriver),
    alreadyFullscreen: document.fullscreenElement !== null,
  }
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>
}

/** Call from a click handler. Never throws, never blocks. */
export function enterGameFullscreen(): void {
  try {
    if (!shouldEnterFullscreen(readEnv())) return
    void document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape'))
      .catch(() => undefined)
  } catch {
    // Fullscreen is an extra; the game works without it.
  }
}
