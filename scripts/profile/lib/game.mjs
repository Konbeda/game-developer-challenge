/**
 * Drives the PRODUCTION build through the real UI and the keyboard, exactly like a player.
 * The production bundle has no `window.__game`, so nothing here reads or writes game state.
 */

export const PLAYER_NAME = 'Profiler'

const t = (id) => `[data-testid="${id}"]`

/** Opens the app and waits for the main menu. Dismisses the first-visit name dialog. */
export async function openApp(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.locator(t('screen-menu')).first().waitFor({ timeout: 30_000 })
  const dialog = page.locator(t('name-dialog'))
  if (await dialog.isVisible().catch(() => false)) {
    await page.fill(t('name-input'), PLAYER_NAME)
    await page.click(t('name-submit'))
    await dialog.waitFor({ state: 'hidden' })
  }
}

/** Sets session time and enemy spawn interval through the Options screen and saves them. */
export async function configureMatch(page, { sessionSeconds, spawnSeconds }) {
  await page.click(t('menu-options'))
  await page.locator(t('screen-options')).first().waitFor()
  await page.fill(t('options-session-input'), String(sessionSeconds))
  await page.fill(t('options-spawn-input'), String(spawnSeconds))
  await page.click(t('options-save'))
  await page
    .locator(`${t('options-status')}:has-text("Options saved")`)
    .first()
    .waitFor()
  const shown = await page.evaluate(() => ({
    session: document.querySelector('[data-testid="options-session-input"]').value,
    spawn: document.querySelector('[data-testid="options-spawn-input"]').value,
  }))
  await page.click(t('options-back'))
  await page.locator(t('screen-menu')).first().waitFor()
  return shown
}

/** Screen / phase / HUD values, read from the DOM only. */
export function readState(page) {
  return page.evaluate(() => {
    const game = document.querySelector('[data-screen="game"]')
    const screen = document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null
    const text = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null
    const health = document.querySelector('[data-testid="hud-health"]')
    return {
      screen,
      phase: game?.getAttribute('data-phase') ?? null,
      score: text('hud-score'),
      time: text('hud-time'),
      health: health ? Number(health.getAttribute('data-health')) : null,
      canvases: document.querySelectorAll('canvas').length,
      /** Combat time recorded by the in-page sampler so far (ms). */
      runMs: window.__prof ? window.__prof.sumMs : null,
    }
  })
}

/**
 * Clicks Play and waits until the match is running. Returns how long loading took
 * (click -> phase 'running'), measured with performance.now() inside the page.
 */
export async function startMatch(page, { playSelector = t('menu-play') } = {}) {
  await page.evaluate(() => {
    window.__clickAt = performance.now()
  })
  await page.click(playSelector)
  await page
    .locator(`${t('screen-game')}[data-phase="running"]`)
    .first()
    .waitFor({ timeout: 60_000 })
  return page.evaluate(() => {
    const running = performance.now()
    return { loadMs: Math.round((running - window.__clickAt) * 10) / 10 }
  })
}

const HELD = ['KeyW', 'Space', 'KeyQ', 'KeyE']

/**
 * Keyboard bot with no access to game state. It holds forward and all three cannons (so shots,
 * impacts and explosions keep the effect pools busy) and alternates the turn direction on a fixed
 * cycle. `turnMs` is how long one direction is held.
 */
export class KeyBot {
  constructor(page, { turnMs = 1500, held = HELD } = {}) {
    this.page = page
    this.turnMs = turnMs
    this.held = held
    this.down = new Set()
    this.turn = null
    this.lastSwitch = 0
    this.turnIndex = 0
  }

  async press(code) {
    if (this.down.has(code)) return
    this.down.add(code)
    await this.page.keyboard.down(code)
  }

  async release(code) {
    if (!this.down.has(code)) return
    this.down.delete(code)
    await this.page.keyboard.up(code)
  }

  /** Call regularly; cheap when nothing changes. */
  async tick(nowMs) {
    for (const code of this.held) await this.press(code)
    if (nowMs - this.lastSwitch >= this.turnMs || this.turn === null) {
      this.lastSwitch = nowMs
      const next = this.turnIndex % 2 === 0 ? 'KeyD' : 'KeyA'
      this.turnIndex += 1
      if (this.turn && this.turn !== next) await this.release(this.turn)
      this.turn = next
      await this.press(next)
    }
  }

  async releaseAll() {
    for (const code of [...this.down]) await this.release(code)
    this.turn = null
  }
}

/** Pauses with the pause key and leaves through the pause dialog's "Main menu". */
export async function leaveViaPause(page) {
  await page.keyboard.press('KeyP')
  await page.locator(t('pause-dialog')).first().waitFor()
  await page.click(t('pause-main-menu'))
  await page.locator(t('screen-menu')).first().waitFor()
}

/** Measures the display/rAF cadence for `frames` frames (used on the idle menu). */
export function measureRefreshHz(page, frames = 240) {
  return page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const stamps = []
        const step = (now) => {
          stamps.push(now)
          if (stamps.length <= count) requestAnimationFrame(step)
          else resolve(Math.round((count / (stamps[count] - stamps[0])) * 10000) / 10)
        }
        requestAnimationFrame(step)
      }),
    frames,
  )
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const selectors = { t }
