import {
  EMPTY_BOARD_CONFIG,
  advance,
  expect,
  finishMatch,
  startMatch,
  test,
} from './support/index.ts'

// Visual regression (README section 8): main menu, the arena in a stable state and the result screen.
// Baselines live in e2e/__screenshots__/<project>/ and are generated with the software renderer
// (default bundled Chromium), the reproducible reference: GPU output differs by machine, so these
// specs are skipped under E2E_GPU=1.

test.skip(process.env.E2E_GPU === '1', 'visual baselines use the software renderer')

const FROZEN = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
`

async function settle(page: import('@playwright/test').Page) {
  await page.addStyleTag({ content: FROZEN })
  await page.evaluate(async () => {
    await document.fonts.ready
    // Every image the UI preloaded must be decoded before the frame is captured.
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)))
    // The game draws on the next animation frame after a manual-clock advance: wait for it.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
}

test.describe('Visual regression', () => {
  test('main menu', async ({ app, page }) => {
    await app.open({ name: 'Tester' })
    await expect(app.menu.root).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('menu.png')
  })

  test('arena in a stable state', async ({ app, page }) => {
    // A slow spawn interval keeps the scene empty and identical between runs; the clock is manual.
    await app.open({ seed: 1234, config: { sessionSeconds: 180, spawnIntervalMs: 10_000 } })
    await startMatch(page)
    await advance(page, 12_000) // the first enemy is on the sea, the player sits still
    await settle(page)
    await expect(app.game.root).toHaveScreenshot('arena.png')
  })

  test('result screen', async ({ app, page }) => {
    await app.open({ seed: 1234, config: EMPTY_BOARD_CONFIG })
    await startMatch(page)
    await finishMatch(page)
    await app.result.expectStatus('synced')
    await settle(page)
    // The play time and score are deterministic for this seed; hide only the timestamp-free fields we cannot pin.
    await expect(page).toHaveScreenshot('result.png')
  })
})
