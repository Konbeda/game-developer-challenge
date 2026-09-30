import { expect, test as base } from '@playwright/test'
import { openApp, reloadApp, type OpenAppOptions } from './app.ts'
import { App } from './pages.ts'

export interface AppFixtures {
  /** Page objects for every screen; `app.open(options)` = `openApp(page, options)`. */
  app: App & { open: (options?: OpenAppOptions) => Promise<void>; reload: () => Promise<void> }
  /**
   * Allow Chromium's own console line for failed resource loads ("Failed to load resource: the
   * server responded with a status of 503", "net::ERR_FAILED"). Set it with `test.use` in the
   * specs that deliberately run outage scenarios; every other console error stays fatal.
   */
  allowNetworkErrors: boolean
  /** Extra message patterns tolerated by the console guard (per spec, keep them narrow). */
  allowedConsoleErrors: RegExp[]
  /** Console errors and uncaught exceptions collected so far (read-only view of the auto guard). */
  consoleErrors: string[]
}

const NETWORK_NOISE = [/Failed to load resource/i, /net::ERR_/i]

/**
 * Playwright `test` with the app fixtures. Every test runs in a fresh browser context, so
 * localStorage, IndexedDB, the service worker and cookies start empty: state is isolated by
 * construction, and `openApp` only seeds what the test asks for.
 *
 * The auto fixture `consoleErrors` FAILS the test when the page logs `console.error` or throws an
 * uncaught exception/unhandled rejection (README section 10: the console stays clean during the
 * planned flows), except for the patterns allowed through `allowNetworkErrors` / `allowedConsoleErrors`.
 */
export const test = base.extend<AppFixtures>({
  allowNetworkErrors: [false, { option: true }],
  allowedConsoleErrors: [[], { option: true }],

  consoleErrors: [
    async ({ page, context, allowNetworkErrors, allowedConsoleErrors }, use) => {
      const tolerated = [...allowedConsoleErrors, ...(allowNetworkErrors ? NETWORK_NOISE : [])]
      const errors: string[] = []
      context.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (tolerated.some((pattern) => pattern.test(text))) return
        errors.push(`console.error: ${text}`)
      })
      page.on('pageerror', (error) => {
        const text = error.stack ?? error.message
        if (tolerated.some((pattern) => pattern.test(text))) return
        errors.push(`pageerror: ${text}`)
      })
      await use(errors)
      expect(errors, 'the console must stay free of unexpected errors').toEqual([])
    },
    { auto: true },
  ],

  app: async ({ page }, use) => {
    const app = new App(page)
    await use(
      Object.assign(app, {
        open: (options?: OpenAppOptions) => openApp(page, options),
        reload: () => reloadApp(page),
      }),
    )
  },
})

export { expect }
