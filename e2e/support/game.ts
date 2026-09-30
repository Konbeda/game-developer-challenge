import { expect, type Page } from '@playwright/test'
import type { HudState, SimSnapshot } from '../../src/game/contracts.ts'
import type { MatchSubmission } from '../../src/contracts/match.ts'
import { readLastResult } from './storage.ts'

/** True while a game screen is mounted and the simulation exists (the test hook is only present then). */
export function hasMatch(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(window.__game?.getSnapshot()))
}

/** Waits until `window.__game` exposes a running simulation (the arena is loaded and the match started). */
export async function waitForMatch(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__game?.getSnapshot()))
}

/** Clicks Play on the main menu and waits until the match exists. */
export async function startMatch(page: Page): Promise<void> {
  await page.getByTestId('menu-play').click()
  await waitForMatch(page)
}

/** Current simulation snapshot (throws when no match is mounted). */
export async function snapshot(page: Page): Promise<SimSnapshot> {
  const value = await page.evaluate(() => window.__game?.getSnapshot() ?? null)
  if (!value) throw new Error('No match is mounted: window.__game has no snapshot')
  return value
}

/** Current HUD state the host reports to React (phase, score, time, health). */
export async function hud(page: Page): Promise<HudState> {
  const value = await page.evaluate(() => window.__game?.getHud() ?? null)
  if (!value) throw new Error('No match is mounted: window.__game is missing')
  return value
}

/**
 * Manual clock only (`openApp` default): runs whole fixed steps covering `ms` of game time with the
 * inputs currently held. The rules, collisions and rendering run for real.
 */
export async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((amount) => {
    const game = window.__game
    if (!game) throw new Error('window.__game is missing')
    game.advance(amount)
  }, ms)
}

/**
 * Plays the running match to its end on the manual clock (nobody touches the controls) and waits for
 * the result screen. Advances until the simulation ends, then covers the 1.3 s end animation the
 * host waits for before it tells the UI. Returns the persisted submission of that match.
 */
export async function finishMatch(page: Page): Promise<MatchSubmission> {
  await page.evaluate(() => {
    const game = window.__game
    if (!game) throw new Error('window.__game is missing')
    let guard = 0
    while (game.getHud().phase === 'running' && guard < 400) {
      game.advance(1_000)
      guard += 1
    }
    game.advance(1_500)
  })
  await expect(page.getByTestId('screen-result')).toBeVisible()
  const submission = await readLastResult(page)
  if (!submission) throw new Error('The finished match was not persisted as the last result')
  return submission
}

/**
 * Plays the running match to its end with a tiny auto-aim bot that uses the REAL keyboard pipeline
 * (it dispatches `keydown`/`keyup` for W/A/S/D and the Up arrow on `window`): it sails towards the
 * nearest enemy (8 directions) and fires the front cannon when lined up. With `seed: 1`, `EMPTY_BOARD_CONFIG` style configs and a
 * long spawn interval (e.g. 60 s / 10 s) it survives to `time_up`; an idle player (`finishMatch`)
 * is always destroyed. The viewport is shrunk while the bot runs (every `advance` renders once and
 * software WebGL is slow at full size) and restored afterwards. Returns the persisted submission.
 */
export async function playBotToEnd(page: Page, stepMs = 100): Promise<MatchSubmission> {
  const original = page.viewportSize()
  await page.setViewportSize({ width: 480, height: 270 })
  await page.evaluate((step) => {
    const game = window.__game
    if (!game) throw new Error('window.__game is missing')
    const held = new Set<string>()
    const set = (code: string, down: boolean) => {
      if (down === held.has(code)) return
      if (down) held.add(code)
      else held.delete(code)
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }))
    }
    const normalise = (angle: number) => {
      let value = angle
      while (value > Math.PI) value -= 2 * Math.PI
      while (value < -Math.PI) value += 2 * Math.PI
      return value
    }
    let guard = 0
    while (game.getHud().phase === 'running' && guard < 100_000) {
      guard += 1
      const snap = game.getSnapshot()
      if (!snap) break
      let target: { x: number; y: number } | null = null
      let best = Infinity
      for (const enemy of snap.enemies) {
        const distance = Math.hypot(enemy.x - snap.player.x, enemy.y - snap.player.y)
        if (distance < best) {
          best = distance
          target = enemy
        }
      }
      if (target) {
        const toTarget = Math.atan2(target.y - snap.player.y, target.x - snap.player.x)
        const ax = Math.cos(toTarget)
        const ay = Math.sin(toTarget)
        set('KeyD', ax > 0.38)
        set('KeyA', ax < -0.38)
        set('KeyS', ay > 0.38)
        set('KeyW', ay < -0.38)
        set('ArrowUp', Math.abs(normalise(toTarget - snap.player.angle)) < 0.2)
      } else {
        for (const code of ['KeyD', 'KeyA', 'KeyS', 'KeyW', 'ArrowUp']) set(code, false)
      }
      game.advance(step)
    }
    for (const code of [...held]) set(code, false)
    game.advance(1_500)
  }, stepMs)
  await expect(page.getByTestId('screen-result')).toBeVisible()
  if (original) await page.setViewportSize(original)
  const submission = await readLastResult(page)
  if (!submission) throw new Error('The finished match was not persisted as the last result')
  return submission
}

/** Starts a match from the menu and plays it to the result screen. */
export async function playMatchToResult(page: Page): Promise<MatchSubmission> {
  await startMatch(page)
  return finishMatch(page)
}

type TouchAction = 'fireFront' | 'fireLeft' | 'fireRight'

const TOUCH_TESTIDS: Record<TouchAction, string> = {
  fireFront: 'touch-fire-front',
  fireLeft: 'touch-fire-left',
  fireRight: 'touch-fire-right',
}

/**
 * Presses an on-screen control with its own synthetic touch pointer (`pointerId` distinct per
 * button), so several controls can be held at once like two thumbs. Needs `?touch=1` or a touch
 * device. `touchRelease` lifts it again.
 */
export async function touchPress(
  page: Page,
  action: TouchAction,
  pointerId: number,
): Promise<void> {
  await page.getByTestId(TOUCH_TESTIDS[action]).dispatchEvent('pointerdown', {
    pointerId,
    pointerType: 'touch',
    isPrimary: pointerId === 1,
    button: 0,
    buttons: 1,
    pressure: 0.5,
  })
}

export async function touchRelease(
  page: Page,
  action: TouchAction,
  pointerId: number,
): Promise<void> {
  await page.getByTestId(TOUCH_TESTIDS[action]).dispatchEvent('pointerup', {
    pointerId,
    pointerType: 'touch',
    isPrimary: pointerId === 1,
    button: 0,
    buttons: 0,
    pressure: 0,
  })
}

/** Number of projectiles currently in flight, by owner. */
export function projectilesBy(snap: SimSnapshot, owner: 'player' | 'enemy'): number {
  return snap.projectiles.filter((p) => p.owner === owner).length
}

// ---- steering stick ----------------------------------------------------------------------------

/** Same as the component: a full push is 85 % of the pad radius. */
const STICK_FULL_PUSH = 0.85

async function stickPoint(page: Page, angle: number, magnitude: number) {
  const box = await page.getByTestId('touch-stick').boundingBox()
  if (!box)
    throw new Error('The steering stick is not on screen (needs ?touch=1 or a touch device)')
  const radius = box.width / 2
  const distance = magnitude * STICK_FULL_PUSH * radius
  return {
    clientX: box.x + radius + Math.cos(angle) * distance,
    clientY: box.y + radius + Math.sin(angle) * distance,
  }
}

async function stickEvent(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  pointerId: number,
  point: { clientX: number; clientY: number },
) {
  await page.getByTestId('touch-stick').dispatchEvent(type, {
    pointerId,
    pointerType: 'touch',
    isPrimary: pointerId === 1,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pressure: type === 'pointerup' ? 0 : 0.5,
    ...point,
  })
}

/**
 * Puts a finger on the steering stick pointing at `angle` (radians, 0 = east, clockwise positive,
 * like the simulation) pushed `magnitude` of the way (0..1). Dead zone is 0.2.
 */
export async function touchStickDown(
  page: Page,
  angle: number,
  magnitude: number,
  pointerId: number,
): Promise<void> {
  await stickEvent(page, 'pointerdown', pointerId, await stickPoint(page, angle, magnitude))
}

/** Slides the finger that is already down on the stick to a new direction/push. */
export async function touchStickMove(
  page: Page,
  angle: number,
  magnitude: number,
  pointerId: number,
): Promise<void> {
  await stickEvent(page, 'pointermove', pointerId, await stickPoint(page, angle, magnitude))
}

/** Lifts the finger from the stick. */
export async function touchStickUp(page: Page, pointerId: number): Promise<void> {
  await stickEvent(page, 'pointerup', pointerId, await stickPoint(page, 0, 0))
}
