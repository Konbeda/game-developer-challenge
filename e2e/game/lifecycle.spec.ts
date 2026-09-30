import {
  advance,
  expect,
  finishMatch,
  hud,
  playBotToEnd,
  readLastResult,
  snapshot,
  startMatch,
  TIME_UP_CONFIG,
  test,
} from '../support/index.ts'
import { KEYS, sample } from './helpers.ts'

// README items 6 and 7: end of match (time and death), stopped simulation, clean restart,
// pause, focus loss and resume.

test.describe('End of match', () => {
  test('ends by time: frozen simulation afterwards and the right reason on the result screen', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 1, config: TIME_UP_CONFIG })
    await startMatch(page)
    const submission = await playBotToEnd(page)
    expect(submission.endReason).toBe('time_up')
    expect(submission.durationMs).toBeGreaterThanOrEqual(
      TIME_UP_CONFIG.sessionSeconds * 1000 - 1_000,
    )
    await expect(app.result.reason).toContainText(/time up/i)
    await expect(app.result.score).toHaveText(String(submission.score))
  })

  test('ends by death, and nothing changes once it ended', async ({ app, page }) => {
    await app.open({ seed: 2 })
    await startMatch(page)

    const frozen = await page.evaluate(() => {
      const game = window.__game!
      let guard = 0
      while (game.getHud().phase === 'running' && guard < 400) {
        game.advance(500)
        guard += 1
      }
      const a = game.getSnapshot()!
      const phaseA = game.getHud().phase
      game.advance(900) // still inside the end animation window: the UI has not left the game yet
      const b = game.getSnapshot()!
      return { a, b, phaseA }
    })

    expect(frozen.phaseA).toBe('ended')
    expect(frozen.a.player.health).toBe(0)
    // The simulation is stopped: time, score, positions and projectiles are all identical.
    expect(frozen.b.timeMs).toBe(frozen.a.timeMs)
    expect(frozen.b.score).toBe(frozen.a.score)
    expect(frozen.b.player).toEqual(frozen.a.player)
    expect(frozen.b.enemies).toEqual(frozen.a.enemies)
    expect(frozen.b.projectiles).toEqual(frozen.a.projectiles)

    await advance(page, 1_500)
    await expect(app.result.root).toBeVisible()
    const submission = await readLastResult(page)
    expect(submission?.endReason).toBe('player_destroyed')
    await expect(app.result.reason).toContainText(/defeated/i)
  })

  test('Play Again gives a clean match: full health, zero score, full clock, empty sea', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 2 })
    await startMatch(page)
    const first = await finishMatch(page)

    await app.result.playAgain.click()
    await page.waitForFunction(() => window.__game?.getHud().phase === 'running')
    const state = await hud(page)
    const snap = await snapshot(page)
    expect(state.score).toBe(0)
    expect(state.playerHealth).toBe(state.playerMaxHealth)
    expect(snap.enemies).toHaveLength(0)
    expect(snap.projectiles).toHaveLength(0)
    expect(snap.timeMs).toBeLessThan(500)

    const second = await finishMatch(page)
    expect(second.matchId).not.toBe(first.matchId)
  })

  test('Restart from the pause dialog also starts from scratch', async ({ app, page }) => {
    await app.open({ seed: 4 })
    await startMatch(page)
    await advance(page, 5_000)
    await app.game.pause.click()
    await expect(app.game.pauseDialog).toBeVisible()
    await app.game.restart.click()
    await expect(app.game.pauseDialog).toBeHidden()
    await page.waitForFunction(() => window.__game?.getHud().phase === 'running')
    const snap = await snapshot(page)
    expect(snap.timeMs).toBeLessThan(500)
    expect(snap.score).toBe(0)
    expect(snap.player.health).toBe(snap.player.maxHealth)
    expect(snap.enemies).toHaveLength(0)
  })

  test('determinism: the same seed and inputs give the same match', async ({ app, page }) => {
    const run = async () => {
      await app.open({ seed: 42 })
      await startMatch(page)
      await page.keyboard.down(KEYS.east)
      await page.keyboard.down(KEYS.south)
      const snaps = await sample(page, 8_000, 500)
      await page.keyboard.up(KEYS.east)
      await page.keyboard.up(KEYS.south)
      return snaps.map((s) => ({
        t: s.timeMs,
        p: [
          Math.round(s.player.x * 1000),
          Math.round(s.player.y * 1000),
          Math.round(s.player.angle * 1000),
        ],
        e: s.enemies.map((e) => [e.id, e.kind, Math.round(e.x * 1000), Math.round(e.y * 1000)]),
        n: s.projectiles.length,
      }))
    }
    const first = await run()
    const second = await run()
    expect(second).toEqual(first)
  })

  test('a 180 s match at the fastest spawn interval stays sane', async ({ app, page }) => {
    await app.open({ seed: 9, config: { sessionSeconds: 180, spawnIntervalMs: 500 } })
    await startMatch(page)
    const stats = await page.evaluate(() => {
      const game = window.__game!
      let maxEnemies = 0
      let maxProjectiles = 0
      for (let i = 0; i < 3_600 && game.getHud().phase === 'running'; i++) {
        game.advance(50)
        const s = game.getSnapshot()!
        maxEnemies = Math.max(maxEnemies, s.enemies.length)
        maxProjectiles = Math.max(maxProjectiles, s.projectiles.length)
      }
      return { maxEnemies, maxProjectiles, phase: game.getHud().phase }
    })
    expect(stats.maxEnemies).toBeLessThanOrEqual(10)
    expect(stats.maxProjectiles).toBeLessThan(200)
  })
})

test.describe('Pause, focus loss and resume', () => {
  test.beforeEach(async ({ app, page }) => {
    await app.open({ seed: 6, config: { sessionSeconds: 180, spawnIntervalMs: 10_000 } })
    await startMatch(page)
    await advance(page, 1_000)
  })

  test('pausing freezes the clock, the ship and the cooldowns', async ({ app, page }) => {
    await page.keyboard.down(KEYS.east)
    await advance(page, 500)
    await page.keyboard.up(KEYS.east)
    await app.game.pause.click()
    await expect(app.game.pauseDialog).toBeVisible()
    expect((await hud(page)).phase).toBe('paused')

    const before = await snapshot(page)
    await advance(page, 5_000)
    const after = await snapshot(page)
    expect(after.timeMs).toBe(before.timeMs)
    expect(after.player).toEqual(before.player)
    expect((await hud(page)).timeRemainingMs).toBe(Math.ceil((180_000 - before.timeMs) / 100) * 100)
  })

  test('losing window focus pauses; resuming needs an explicit click', async ({ app, page }) => {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect.poll(async () => (await hud(page)).phase).toBe('paused')
    await expect(app.game.pauseDialog).toBeVisible()

    const before = await snapshot(page)
    await advance(page, 3_000)
    expect((await snapshot(page)).timeMs).toBe(before.timeMs)
    // Coming back does not resume by itself.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect((await hud(page)).phase).toBe('paused')

    await app.game.resume.click()
    await expect.poll(async () => (await hud(page)).phase).toBe('running')
  })

  test('hiding the tab pauses the match', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(async () => (await hud(page)).phase).toBe('paused')
  })

  test('resume does not jump the clock and drops anything held during the pause', async ({
    app,
    page,
  }) => {
    await app.game.pause.click()
    await expect(app.game.pauseDialog).toBeVisible()
    const paused = await snapshot(page)

    // The player mashes keys while paused; none of it may take effect after resuming.
    await page.keyboard.down(KEYS.east)
    await page.keyboard.down(KEYS.front)
    await advance(page, 2_000)
    await app.game.resume.click()
    await expect.poll(async () => (await hud(page)).phase).toBe('running')

    const resumed = await snapshot(page)
    expect(resumed.timeMs).toBe(paused.timeMs) // no time accumulated while paused
    await advance(page, 1_000)
    const later = await snapshot(page)
    // Still holding the keys physically, but the game asked for a fresh press: nothing moved, nothing fired.
    expect(
      Math.hypot(later.player.x - paused.player.x, later.player.y - paused.player.y),
    ).toBeLessThan(2)
    expect(later.projectiles.filter((p) => p.owner === 'player')).toHaveLength(0)
    await page.keyboard.up(KEYS.east)
    await page.keyboard.up(KEYS.front)
  })

  test('Escape pauses and resumes a manual pause', async ({ app, page }) => {
    await page.keyboard.press('Escape')
    await expect(app.game.pauseDialog).toBeVisible()
    expect((await hud(page)).phase).toBe('paused')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await hud(page)).phase).toBe('running')
  })
})
