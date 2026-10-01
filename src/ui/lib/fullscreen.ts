/**
 * Phones show the browser's address bar, which steals a lot of height in landscape. On a real touch device
 * the game asks for fullscreen and a landscape lock (browsers only allow the lock while fullscreen) in two
 * ways: automatically when a match starts, and from explicit buttons (menu, "rotate your device" notice).
 * Both need a user gesture, so they are called straight from a click. Everything is best effort:
 * unsupported browsers (iPhone Safari) or a refusal just keep the page as it is.
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

/** Decision for the automatic request made when a match starts. */
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
  unlock?: () => void
}

const orientation = (): LockableOrientation | undefined =>
  screen.orientation as LockableOrientation | undefined

/** True on a real touch device whose browser offers the Fullscreen API: the buttons are shown only then. */
export function canControlFullscreen(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && Boolean(document.fullscreenEnabled)
  } catch {
    return false
  }
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null
}

/** Calls `listener` whenever fullscreen is entered or left. Returns the unsubscribe function. */
export function subscribeFullscreen(listener: () => void): () => void {
  document.addEventListener('fullscreenchange', listener)
  return () => document.removeEventListener('fullscreenchange', listener)
}

/**
 * Fullscreen plus a landscape lock. Used by the buttons: because it is an explicit tap it also works
 * with the phone held upright (the lock rotates the page). Never throws.
 */
export async function enterLandscapeFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement === null) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    }
  } catch {
    // Refused: the lock below may still be allowed (installed web apps), otherwise nothing changes.
  }
  try {
    await orientation()?.lock?.('landscape')
  } catch {
    // Not supported or not allowed outside fullscreen.
  }
}

/** Leaves fullscreen and releases the orientation lock. Never throws. */
export async function leaveFullscreen(): Promise<void> {
  try {
    orientation()?.unlock?.()
  } catch {
    // Nothing to release.
  }
  try {
    if (document.fullscreenElement !== null) await document.exitFullscreen()
  } catch {
    // Already out.
  }
}

/** Automatic request when a match starts. Call from a click handler. Never throws, never blocks. */
export function enterGameFullscreen(): void {
  try {
    if (!shouldEnterFullscreen(readEnv())) return
    void enterLandscapeFullscreen()
  } catch {
    // Fullscreen is an extra; the game works without it.
  }
}

/** True for iPhone/iPad/iPod, including iPadOS which reports itself as a Mac with a touch screen. */
export function detectIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true
  return platform === 'MacIntel' && maxTouchPoints > 1
}

export function isIos(): boolean {
  try {
    return detectIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
  } catch {
    return false
  }
}

/** Running as an installed web app (Home Screen shortcut): already fullscreen, no browser bars. */
export function isStandalone(): boolean {
  try {
    const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true
    return legacy || window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/**
 * iPhone Safari lets pages neither enter fullscreen nor lock the orientation, so on iOS (outside an
 * installed web app) the UI shows tips instead of buttons.
 */
export function needsIosTips(): boolean {
  return isIos() && !isStandalone() && !canControlFullscreen()
}
