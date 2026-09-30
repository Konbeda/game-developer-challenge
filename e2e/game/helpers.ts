import type { Page } from '@playwright/test'
import type { SimSnapshot } from '../../src/game/contracts.ts'

/**
 * Advances the manual clock in `stepMs` slices for `totalMs` and returns a snapshot after each slice.
 * The loop runs inside the page so long stretches stay fast; inputs held through the real keyboard
 * (page.keyboard) stay held for the whole stretch.
 */
export function sample(page: Page, totalMs: number, stepMs = 100): Promise<SimSnapshot[]> {
  return page.evaluate(
    ({ total, step }) => {
      const game = window.__game
      if (!game) throw new Error('window.__game is missing')
      const out: SimSnapshot[] = []
      for (let elapsed = 0; elapsed < total; elapsed += step) {
        game.advance(step)
        const snap = game.getSnapshot()
        if (!snap) break
        out.push(snap)
      }
      return out
    },
    { total: totalMs, step: stepMs },
  )
}

/** Real keyboard shortcuts (KeyboardEvent.code), same bindings the game uses. */
export const KEYS = {
  forward: 'KeyW',
  left: 'KeyA',
  right: 'KeyD',
  front: 'Space',
  portBroadside: 'KeyQ',
  starboardBroadside: 'KeyE',
} as const

/** Normalises an angle difference to (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d <= -Math.PI) d += 2 * Math.PI
  return d
}
