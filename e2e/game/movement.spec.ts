import { DEFAULT_GAMEPLAY } from '../../src/config/gameplay.ts'
import { ARENA, type SimSnapshot } from '../../src/game/contracts.ts'
import { advance, expect, snapshot, startMatch, test } from '../support/index.ts'
import { angleDiff, KEYS, sample } from './helpers.ts'

// README item 3: start of match, movement, rotation, arena limits and island collision.

const { player, islands } = DEFAULT_GAMEPLAY

test.describe('Movement and rotation', () => {
  test.beforeEach(async ({ app, page }) => {
    await app.open({ seed: 3 })
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

  test('a ship only moves forward while the forward key is held', async ({ page }) => {
    const start = await snapshot(page)
    await advance(page, 500)
    const idle = await snapshot(page)
    expect(idle.player.x).toBeCloseTo(start.player.x, 1)

    await page.keyboard.down(KEYS.forward)
    await advance(page, 1_000)
    const moved = await snapshot(page)
    // Heading east: x grows, y stays put.
    expect(moved.player.x - start.player.x).toBeGreaterThan(80)
    expect(Math.abs(moved.player.y - start.player.y)).toBeLessThan(2)
    // Speed never exceeds the configured maximum.
    expect(moved.player.x - start.player.x).toBeLessThanOrEqual(player.maxSpeed * 1.05)

    await page.keyboard.up(KEYS.forward)
    await advance(page, 1_000)
    const stopped = await snapshot(page)
    await advance(page, 500)
    const later = await snapshot(page)
    expect(later.player.x).toBeCloseTo(stopped.player.x, 1)
  })

  test('turning left and right rotates at the configured rate', async ({ page }) => {
    const start = await snapshot(page)
    await page.keyboard.down(KEYS.right)
    await advance(page, 500)
    await page.keyboard.up(KEYS.right)
    const right = await snapshot(page)
    // Positive angle = clockwise on screen.
    expect(angleDiff(right.player.angle, start.player.angle)).toBeCloseTo(player.turnRate * 0.5, 1)
    // Turning alone does not translate the ship.
    expect(right.player.x).toBeCloseTo(start.player.x, 1)

    await page.keyboard.down(KEYS.left)
    await advance(page, 1_000)
    await page.keyboard.up(KEYS.left)
    const left = await snapshot(page)
    expect(angleDiff(left.player.angle, right.player.angle)).toBeCloseTo(-player.turnRate, 1)
  })

  test('movement and firing work at the same time', async ({ page }) => {
    const start = await snapshot(page)
    await page.keyboard.down(KEYS.forward)
    await page.keyboard.down(KEYS.right)
    await page.keyboard.down(KEYS.front)
    await advance(page, 700)
    const snap = await snapshot(page)
    expect(
      Math.hypot(snap.player.x - start.player.x, snap.player.y - start.player.y),
    ).toBeGreaterThan(40)
    expect(angleDiff(snap.player.angle, start.player.angle)).toBeGreaterThan(0.5)
    expect(snap.projectiles.some((p) => p.owner === 'player')).toBe(true)
  })
})

test.describe('Arena limits', () => {
  // A slow spawn interval keeps every enemy away during the run, so the player survives to measure.
  const config = { sessionSeconds: 180, spawnIntervalMs: 10_000 }
  const r = player.radius
  const quarter = Math.ceil((Math.PI / 2 / player.turnRate) * 1000)
  const half = Math.ceil((Math.PI / player.turnRate) * 1000)

  type Turn = { key: string; ms: number }
  const walls: {
    name: string
    turns: Turn[]
    driveMs: number
    check: (s: SimSnapshot) => number
  }[] = [
    {
      name: 'north',
      turns: [{ key: KEYS.left, ms: quarter }],
      driveMs: 6_000,
      check: (s) => s.player.y,
    },
    {
      name: 'south',
      turns: [{ key: KEYS.right, ms: quarter }],
      driveMs: 7_000,
      check: (s) => ARENA.height - s.player.y,
    },
    {
      name: 'west',
      turns: [{ key: KEYS.right, ms: half }],
      driveMs: 4_000,
      check: (s) => s.player.x,
    },
    // East: go down to the bottom lane first (free of islands), then along it to the east wall.
    {
      name: 'east',
      turns: [{ key: KEYS.right, ms: quarter }],
      driveMs: 0,
      check: (s) => ARENA.width - s.player.x,
    },
  ]

  for (const wall of walls) {
    test(`the ship never leaves the arena and reaches the ${wall.name} wall`, async ({
      app,
      page,
    }) => {
      await app.open({ seed: 3, config })
      await startMatch(page)
      const all: SimSnapshot[] = []
      const hold = async (key: string, ms: number) => {
        await page.keyboard.down(key)
        all.push(...(await sample(page, ms)))
        await page.keyboard.up(key)
      }

      for (const t of wall.turns) await hold(t.key, t.ms)
      if (wall.name === 'east') {
        await hold(KEYS.forward, 4_000) // south wall
        await hold(KEYS.left, quarter) // face east
        await hold(KEYS.forward, 7_000) // along the bottom lane
      } else {
        await hold(KEYS.forward, wall.driveMs)
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
    await app.open({ seed: 3 })
    await startMatch(page)
    // The start lane (heading east at y = 450) runs into the central island.
    const centre = islands.reduce((best, i) =>
      Math.abs(i.y - player.start.y) < Math.abs(best.y - player.start.y) ? i : best,
    )
    await page.keyboard.down(KEYS.forward)
    const samples = await sample(page, 8_000, 50)
    await page.keyboard.up(KEYS.forward)

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
    await app.open({ seed: 3 })
    await startMatch(page)
    const island = islands[0]!
    // Steer slightly towards the island and keep going for a long time.
    await page.keyboard.down(KEYS.right)
    await advance(page, 200)
    await page.keyboard.up(KEYS.right)
    await page.keyboard.down(KEYS.forward)
    const samples = await sample(page, 8_000, 50)
    await page.keyboard.up(KEYS.forward)
    for (const s of samples) {
      for (const i of s.islands) {
        expect(Math.hypot(s.player.x - i.x, s.player.y - i.y)).toBeGreaterThanOrEqual(
          i.radius + player.radius - 1,
        )
      }
    }
    expect(island.radius).toBeGreaterThan(0)
  })
})
