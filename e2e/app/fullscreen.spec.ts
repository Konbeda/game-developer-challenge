import { expect, startMatch, test } from '../support/index.ts'

// Fullscreen / landscape buttons for phones. WebDriver cannot drive real fullscreen, so the browser
// API is replaced by a recorder and the tests check what the buttons ask for.

type FsWindow = Window & { __fsCalls: string[] }

test.describe('Fullscreen and landscape buttons (touch devices)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop', 'the buttons exist only for touch devices')
    await page.addInitScript(() => {
      const calls: string[] = []
      ;(window as unknown as FsWindow).__fsCalls = calls
      let current: Element | null = null
      Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
      Object.defineProperty(document, 'fullscreenElement', {
        get: () => current,
        configurable: true,
      })
      Element.prototype.requestFullscreen = () => {
        calls.push('request')
        current = document.documentElement
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
      document.exitFullscreen = () => {
        calls.push('exit')
        current = null
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }
      Object.defineProperty(screen.orientation, 'lock', {
        value: (orientation: string) => {
          calls.push(`lock:${orientation}`)
          return Promise.resolve()
        },
        configurable: true,
      })
      Object.defineProperty(screen.orientation, 'unlock', {
        value: () => {
          calls.push('unlock')
        },
        configurable: true,
      })
    })
  })

  const calls = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as FsWindow).__fsCalls)

  test('the menu button enters fullscreen in landscape and leaves it again', async ({
    app,
    page,
  }) => {
    await app.open()
    const toggle = page.getByTestId('fullscreen-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(await calls(page)).toEqual(['request', 'lock:landscape'])

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(await calls(page)).toEqual(['request', 'lock:landscape', 'unlock', 'exit'])
  })

  test('the rotate notice offers a button that forces landscape', async ({ app, page }) => {
    await app.open({ touch: true })
    await startMatch(page)
    await page.setViewportSize({ width: 393, height: 851 })
    await expect(page.getByTestId('rotate-overlay')).toBeVisible()

    await page.getByTestId('rotate-landscape').click()
    expect(await calls(page)).toEqual(['request', 'lock:landscape'])
  })

  test('tapping anywhere on the rotate notice also forces landscape', async ({ app, page }) => {
    await app.open({ touch: true })
    await page.setViewportSize({ width: 393, height: 851 })
    const overlay = page.getByTestId('rotate-overlay')
    await expect(overlay).toBeVisible()
    await overlay.click({ position: { x: 12, y: 12 } })
    expect(await calls(page)).toEqual(['request', 'lock:landscape'])
  })

  test('starting a match never changes the window under an automated run', async ({
    app,
    page,
  }) => {
    await app.open()
    await startMatch(page)
    // Under WebDriver the automatic request is skipped on purpose (real phones do it on Play).
    expect(await calls(page)).toEqual([])
  })
})
