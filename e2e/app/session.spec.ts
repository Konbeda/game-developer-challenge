import {
  advance,
  expect,
  hasMatch,
  readLastResult,
  readOutbox,
  snapshot,
  startMatch,
  test,
  touchPress,
  touchRelease,
  waitForMatch,
} from '../support/index.ts'

// README items 2 and 9: asset loading and failures, abandonment, repeated navigation, touch controls.

test.describe('Asset loading', () => {
  test.use({ allowNetworkErrors: true, allowedConsoleErrors: [/Failed to load|texture|asset/i] })

  test('a failed download shows an error with Retry, and Retry starts the match', async ({
    app,
    page,
    context,
  }) => {
    await app.open()
    const blocked = '**/assets/png/*/ships/**'
    await context.route(blocked, (route) => route.abort('failed'))

    await app.menu.play.click()
    await expect(app.game.error).toBeVisible({ timeout: 20_000 })
    await expect(app.game.retry).toBeVisible()
    expect(await hasMatch(page)).toBe(false)

    // Retrying while it is still broken keeps showing the error.
    await app.game.retry.click()
    await expect(app.game.error).toBeVisible({ timeout: 20_000 })

    // The network comes back: Retry loads what is missing and the match starts.
    await context.unroute(blocked)
    await app.game.retry.click()
    await waitForMatch(page)
    await expect(app.game.error).toBeHidden()
    await expect(app.game.canvas).toBeVisible()
  })

  test('the player can leave to the menu from the error state and try again later', async ({
    app,
    page,
    context,
  }) => {
    await app.open()
    const blocked = '**/assets/png/*/ships/**'
    await context.route(blocked, (route) => route.abort('failed'))
    await app.menu.play.click()
    await expect(app.game.error).toBeVisible({ timeout: 20_000 })
    await app.game.errorMenu.click()
    await expect(app.menu.root).toBeVisible()

    await context.unroute(blocked)
    await startMatch(page)
    expect(await hasMatch(page)).toBe(true)
  })

  test('shows a loading state with progress before the arena', async ({ app, page, context }) => {
    await app.open()
    // Delay the ship textures so the loading screen stays up long enough to observe.
    await context.route('**/assets/png/*/ships/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    await app.menu.play.click()
    await expect(app.game.loading).toBeVisible()
    await expect(app.game.progress).toBeVisible()
    await waitForMatch(page)
    await expect(app.game.loading).toBeHidden()
  })
})

test.describe('Abandonment and repeated navigation', () => {
  test('reloading during a match records nothing', async ({ app, page }) => {
    await app.open()
    await startMatch(page)
    await advance(page, 5_000)
    await app.reload()
    await expect(app.menu.root).toBeVisible()

    expect(await readLastResult(page)).toBeNull()
    expect(await readOutbox(page)).toEqual([])
    await app.openLog('history')
    await expect(app.log.empty('history')).toBeVisible()
  })

  test('leaving through pause -> Main Menu records nothing', async ({ app, page }) => {
    await app.open()
    await startMatch(page)
    await advance(page, 4_000)
    await app.game.leaveToMenu()
    await expect(app.menu.root).toBeVisible()

    expect(await readLastResult(page)).toBeNull()
    expect(await readOutbox(page)).toEqual([])
    expect(await hasMatch(page)).toBe(false)
    await expect(page.locator('canvas')).toHaveCount(0)
  })

  test('repeated menu <-> game <-> options <-> log navigation stays clean', async ({
    app,
    page,
  }) => {
    await app.open()
    for (let cycle = 0; cycle < 4; cycle++) {
      await startMatch(page)
      await expect(page.locator('canvas')).toHaveCount(1)
      const hud = await page.evaluate(() => window.__game?.getHud())
      expect(hud?.score).toBe(0)
      expect(hud?.playerHealth).toBe(hud?.playerMaxHealth)
      const snap = await snapshot(page)
      expect(snap.enemies).toHaveLength(0)
      expect(snap.timeMs).toBeLessThan(1_000)

      await advance(page, 2_000)
      await app.game.leaveToMenu()
      await expect(page.locator('canvas')).toHaveCount(0)

      await app.openOptions()
      await app.options.back.click()
      await app.openLog('ranking')
      await app.backToMenu()
    }
    await expect(app.menu.root).toBeVisible()
  })
})

test.describe('Touch controls', () => {
  test('are hidden with a mouse and shown with ?touch=1', async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the mobile project always has touch')
    await app.open()
    await startMatch(page)
    await expect(app.game.touchControls).toBeHidden()

    await app.open({ touch: true })
    await startMatch(page)
    await expect(app.game.touchControls).toBeVisible()
  })

  test('multi-touch: forward + front cannon at the same time, and release stops them', async ({
    app,
    page,
  }) => {
    await app.open({ touch: true })
    await startMatch(page)
    const before = await snapshot(page)

    await touchPress(page, 'forward', 1)
    await touchPress(page, 'fireFront', 2)
    await advance(page, 1_500)
    const moving = await snapshot(page)
    expect(
      Math.hypot(moving.player.x - before.player.x, moving.player.y - before.player.y),
    ).toBeGreaterThan(80)
    const fired = moving.projectiles.some((p) => p.owner === 'player')
    expect(fired).toBe(true)

    await touchRelease(page, 'forward', 1)
    await touchRelease(page, 'fireFront', 2)
    await advance(page, 1_200)
    const settled = await snapshot(page)
    await advance(page, 500)
    const later = await snapshot(page)
    expect(
      Math.hypot(later.player.x - settled.player.x, later.player.y - settled.player.y),
    ).toBeLessThan(1)
    // No new player shots once released (existing ones have expired).
    expect(later.projectiles.filter((p) => p.owner === 'player')).toHaveLength(0)
  })

  test('turn buttons rotate the ship', async ({ app, page }) => {
    await app.open({ touch: true })
    await startMatch(page)
    const a = await snapshot(page)
    await touchPress(page, 'turnRight', 3)
    await advance(page, 500)
    await touchRelease(page, 'turnRight', 3)
    const b = await snapshot(page)
    expect(b.player.angle).toBeGreaterThan(a.player.angle + 0.5)

    await touchPress(page, 'turnLeft', 4)
    await advance(page, 1_000)
    await touchRelease(page, 'turnLeft', 4)
    const c = await snapshot(page)
    expect(c.player.angle).toBeLessThan(b.player.angle - 0.5)
  })
})

test.describe('Orientation', () => {
  test('portrait shows the rotate prompt and pauses the match', async ({ app, page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop', 'portrait phones are a mobile concern')
    await app.open({ touch: true })
    await startMatch(page)
    await page.setViewportSize({ width: 393, height: 851 })
    await expect(page.getByTestId('rotate-overlay')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__game?.getHud().phase)).toBe('paused')

    await page.setViewportSize({ width: 851, height: 393 })
    await expect(page.getByTestId('rotate-overlay')).toBeHidden()
    // Coming back to landscape does not resume by itself.
    expect(await page.evaluate(() => window.__game?.getHud().phase)).toBe('paused')
  })
})
