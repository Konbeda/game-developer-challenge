import { DEFAULT_GAMEPLAY } from '../../src/config/gameplay.ts'
import { ARENA, type SimSnapshot } from '../../src/game/contracts.ts'
import { advance, expect, snapshot, startMatch, test } from '../support/index.ts'
import { angleDiff, KEYS, sample } from './helpers.ts'

// README item 3: start of match, movement, rotation, arena limits and island collision.
// Movement is direction based: W/A/S/D name the screen direction to sail (no tank controls).

const { player, islands } = DEFAULT_GAMEPLAY

// A slow spawn interval keeps every enemy away, so the player survives long measurements.
const QUIET = { sessionSeconds: 180, spawnIntervalMs: 10_000 }

test.describe('Movement and rotation', () => {
  test.beforeEach(async ({ app, page }) => {
    await app.open({ seed: 3, config: QUIET })
    await startMatch(page)
  })

  test('the match starts with a fresh ship at the configured spot', async ({ page }) => {
    const snap = await snapshot(page)
    expect(snap.timeMs).toBeLessThan(200)
    expect(snap.score).toBe(0)
    expect(snap.player.health).toBe(player.maxHealth)
    expect(snap.player.x).toBeCloseTo(player.start.x, 0)
    expect(snap.player.y).toBeCloseTo(player.start.y, 0)
    expect(snap.enemies).toHaveLength(0)
    expect(snap.projectiles).toHaveLength(0)
    expect(snap.islands.length).toBeGreaterThan(0)
  })

  test('the ship only sails while a direction key is held, then coasts to a stop', async ({
    page,
  }) => {
    const start = await snapshot(page)
    await advance(page, 500)
    const idle = await snapshot(page)
    expect(idle.player.x).toBeCloseTo(start.player.x, 1)

    // The ship already faces east, so D is straight ahead.
    await page.keyboard.down(KEYS.east)
    await advance(page, 1_000)
    const moved = await snapshot(page)
    expect(moved.player.x - start.player.x).toBeGreaterThan(80)
    expect(Math.abs(moved.player.y - start.player.y)).toBeLessThan(2)
    // Speed never exceeds the configured maximum.
    expect(moved.player.x - start.player.x).toBeLessThanOrEqual(player.maxSpeed * 1.05)

    await page.keyboard.up(KEYS.east)
    await advance(page, 1_000)
    const stopped = await snapshot(page)
    await advance(page, 500)
    const later = await snapshot(page)
    expect(later.player.x).toBeCloseTo(stopped.player.x, 1)
  })

  test('a direction key turns the ship to that screen direction at the configured rate', async ({
    page,
  }) => {
    const start = await snapshot(page)
    // S points south, clockwise from the east-facing bow: the ship swings round at turnRate.
    await page.keyboard.down(KEYS.south)
    await advance(page, 300)
    const turning = await snapshot(page)
    expect(angleDiff(turning.player.angle, start.player.angle)).toBeCloseTo(
      player.turnRate * 0.3,
      1,
    )
    await advance(page, 1_200)
    const south = await snapshot(page)
    expect(Math.abs(angleDiff(south.player.angle, Math.PI / 2))).toBeLessThan(0.1)
    expect(south.player.y).toBeGreaterThan(start.player.y + 20)
    await page.keyboard.up(KEYS.south)

    // W points north, anti-clockwise from south: it swings back the short way round.
    await page.keyboard.down(KEYS.north)
    await advance(page, 2_400)
    await page.keyboard.up(KEYS.north)
    const north = await snapshot(page)
    expect(Math.abs(angleDiff(north.player.angle, -Math.PI / 2))).toBeLessThan(0.1)
  })

  test('two keys make a diagonal, and opposite keys cancel out', async ({ page }) => {
    await page.keyboard.down(KEYS.north)
    await page.keyboard.down(KEYS.east)
    await advance(page, 1_200)
    const northEast = await snapshot(page)
    expect(Math.abs(angleDiff(northEast.player.angle, -Math.PI / 4))).toBeLessThan(0.1)
    await page.keyboard.up(KEYS.north)
    await page.keyboard.up(KEYS.east)
    await advance(page, 1_500)

    // A and D together cancel: no steering, so the ship just coasts to a stop and keeps its heading.
    const before = await snapshot(page)
    await page.keyboard.down(KEYS.west)
    await page.keyboard.down(KEYS.east)
    await advance(page, 1_500)
    const after = await snapshot(page)
    expect(angleDiff(after.player.angle, before.player.angle)).toBeCloseTo(0, 2)
    expect(
      Math.hypot(after.player.x - before.player.x, after.player.y - before.player.y),
    ).toBeLessThan(2)
    await page.keyboard.up(KEYS.west)
    await page.keyboard.up(KEYS.east)
  })

  test('movement and firing work at the same time', async ({ page }) => {
    const start = await snapshot(page)
    await page.keyboard.down(KEYS.south)
    await page.keyboard.down(KEYS.front)
    await advance(page, 700)
    const snap = await snapshot(page)
    expect(
      Math.hypot(snap.player.x - start.player.x, snap.player.y - start.player.y),
    ).toBeGreaterThan(40)
    expect(angleDiff(snap.player.angle, start.player.angle)).toBeGreaterThan(0.5)
    expect(snap.projectiles.some((p) => p.owner === 'player')).toBe(true)
    await page.keyboard.up(KEYS.south)
    await page.keyboard.up(KEYS.front)
  })
})

test.describe('Arena limits', () => {
  const r = player.radius

  type Leg = { key: string; ms: number }
  const walls: { name: string; legs: Leg[]; check: (s: SimSnapshot) => number }[] = [
    { name: 'north', legs: [{ key: KEYS.north, ms: 6_000 }], check: (s) => s.player.y },
    {
      name: 'south',
      legs: [{ key: KEYS.south, ms: 7_000 }],
      check: (s) => ARENA.height - s.player.y,
    },
    { name: 'west', legs: [{ key: KEYS.west, ms: 4_500 }], check: (s) => s.player.x },
    // East: down to the bottom lane first (free of islands), then along it to the east wall.
    {
      name: 'east',
      legs: [
        { key: KEYS.south, ms: 4_000 },
        { key: KEYS.east, ms: 8_000 },
      ],
      check: (s) => ARENA.width - s.player.x,
    },
  ]

  for (const wall of walls) {
    test(`the ship never leaves the arena and reaches the ${wall.name} wall`, async ({
      app,
      page,
    }) => {
      await app.open({ seed: 3, config: QUIET })
      await startMatch(page)
      const all: SimSnapshot[] = []
      for (const leg of wall.legs) {
        await page.keyboard.down(leg.key)
        all.push(...(await sample(page, leg.ms)))
        await page.keyboard.up(leg.key)
      }

      for (const s of all) {
        expect(s.player.x).toBeGreaterThanOrEqual(r - 0.5)
        expect(s.player.x).toBeLessThanOrEqual(ARENA.width - r + 0.5)
        expect(s.player.y).toBeGreaterThanOrEqual(r - 0.5)
        expect(s.player.y).toBeLessThanOrEqual(ARENA.height - r + 0.5)
      }
      // It reached the wall (it pushed against it) but never crossed it.
      expect(Math.min(...all.map(wall.check))).toBeGreaterThanOrEqual(r - 0.5)
      expect(Math.min(...all.map(wall.check))).toBeLessThan(r + 2)
    })
  }
})

test.describe('Islands block ships', () => {
  test('driving straight into an island never overlaps or crosses it', async ({ app, page }) => {
    await app.open({ seed: 3, config: QUIET })
    await startMatch(page)
    // The start lane (heading east at y = 450) runs into the central island.
    const centre = islands.reduce((best, i) =>
      Math.abs(i.y - player.start.y) < Math.abs(best.y - player.start.y) ? i : best,
    )
    await page.keyboard.down(KEYS.east)
    const samples = await sample(page, 8_000, 50)
    await page.keyboard.up(KEYS.east)

    for (const s of samples) {
      for (const island of s.islands) {
        const distance = Math.hypot(s.player.x - island.x, s.player.y - island.y)
        expect(distance).toBeGreaterThanOrEqual(island.radius + player.radius - 1)
      }
    }
    // It reached the island and was held back by it (west of its centre, not on the far side).
    const last = samples.at(-1)!
    expect(last.player.x).toBeLessThan(centre.x)
    expect(last.player.x).toBeGreaterThan(centre.x - centre.radius - player.radius - 40)
  })

  test('grazing an island at an angle slides along it instead of sticking or crossing', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 3, config: QUIET })
    await startMatch(page)
    // South-east runs into the central island's flank; keep pushing for a long time.
    await page.keyboard.down(KEYS.south)
    await page.keyboard.down(KEYS.east)
    const samples = await sample(page, 8_000, 50)
    await page.keyboard.up(KEYS.south)
    await page.keyboard.up(KEYS.east)
    for (const s of samples) {
      for (const i of s.islands) {
        expect(Math.hypot(s.player.x - i.x, s.player.y - i.y)).toBeGreaterThanOrEqual(
          i.radius + player.radius - 1,
        )
      }
    }
    // It kept moving (slid along) instead of freezing against the island.
    const first = samples[20]!
    const last = samples.at(-1)!
    expect(
      Math.hypot(last.player.x - first.player.x, last.player.y - first.player.y),
    ).toBeGreaterThan(40)
  })
})
