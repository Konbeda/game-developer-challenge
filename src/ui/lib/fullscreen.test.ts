import { describe, expect, it } from 'vitest'
import { detectIos, shouldEnterFullscreen, type FullscreenEnv } from './fullscreen.ts'

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

describe('detectIos', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
  const android =
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'

  it('recognises iPhone, iPad and iPod user agents', () => {
    expect(detectIos(iphone, 'iPhone', 5)).toBe(true)
    expect(detectIos('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 'iPad', 5)).toBe(true)
  })

  it('recognises iPadOS, which reports itself as a Mac with a touch screen', () => {
    expect(detectIos(mac, 'MacIntel', 5)).toBe(true)
  })

  it('does not mistake Android or a real Mac for iOS', () => {
    expect(detectIos(android, 'Linux armv81', 5)).toBe(false)
    expect(detectIos(mac, 'MacIntel', 0)).toBe(false)
  })
})
