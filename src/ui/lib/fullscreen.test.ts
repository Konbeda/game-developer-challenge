import { describe, expect, it } from 'vitest'
import { shouldEnterFullscreen, type FullscreenEnv } from './fullscreen.ts'

const phone: FullscreenEnv = {
  coarsePointer: true,
  supported: true,
  automated: false,
  alreadyFullscreen: false,
}

describe('shouldEnterFullscreen', () => {
  it('asks for fullscreen on a real touch device that supports it', () => {
    expect(shouldEnterFullscreen(phone)).toBe(true)
  })

  it('leaves mouse and keyboard devices alone', () => {
    expect(shouldEnterFullscreen({ ...phone, coarsePointer: false })).toBe(false)
  })

  it('does nothing where the Fullscreen API is unavailable (e.g. iPhone Safari)', () => {
    expect(shouldEnterFullscreen({ ...phone, supported: false })).toBe(false)
  })

  it('never changes the window under an automated (WebDriver) run', () => {
    expect(shouldEnterFullscreen({ ...phone, automated: true })).toBe(false)
  })

  it('does not ask again when already fullscreen', () => {
    expect(shouldEnterFullscreen({ ...phone, alreadyFullscreen: true })).toBe(false)
  })
})
