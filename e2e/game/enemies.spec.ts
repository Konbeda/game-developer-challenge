import { DEFAULT_GAMEPLAY } from '../../src/config/gameplay.ts'
import type { SimSnapshot } from '../../src/game/contracts.ts'
import { advance, expect, snapshot, startMatch, test } from '../support/index.ts'
import { sample } from './helpers.ts'

// README item 5: Chaser and Shooter behaviour, spawn interval and spawn-point validity.

const { chaser, shooter, spawn, player } = DEFAULT_GAMEPLAY

test.describe('Spawning', () => {
  test('enemies appear at the configured interval, first one after one full interval', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 11, config: { sessionSeconds: 180, spawnIntervalMs: 5_000 } })
    await startMatch(page)

    await advance(page, 4_800)
    expect((await snapshot(page)).enemies).toHaveLength(0)
    await advance(page, 400) // t = 5.2 s
    const first = await snapshot(page)
    expect(first.enemies).toHaveLength(1)
    await advance(page, 4_600) // t = 9.8 s: still just the first
    const ids = new Set((await snapshot(page)).enemies.map((e) => e.id))
    expect(ids.size).toBeLessThanOrEqual(1)
    await advance(page, 600) // t = 10.4 s: the second has appeared
    const seen = new Set<number>([
      ...first.enemies.map((e) => e.id),
      ...(await snapshot(page)).enemies.map((e) => e.id),
    ])
    expect(seen.size).toBe(2)
  })

  test('a shorter interval spawns proportionally more enemies', async ({ app, page }) => {
    await app.open({ seed: 11, config: { sessionSeconds: 180, spawnIntervalMs: 1_000 } })
    await startMatch(page)
    const ids = new Set<number>()
    const snaps = await sample(page, 6_500, 250)
    for (const s of snaps) for (const e of s.enemies) ids.add(e.id)
    // One per second for 6.5 s (first at 1 s), unless the cap or an early death got in the way.
    expect(ids.size).toBeGreaterThanOrEqual(5)
    expect(ids.size).toBeLessThanOrEqual(6)
  })

  test('spawn points are inside the arena, clear of islands and far from the player (several seeds)', async ({
    app,
    page,
  }) => {
    for (const seed of [1, 2, 3, 4]) {
      await app.open({ seed, config: { sessionSeconds: 180, spawnIntervalMs: 1_500 } })
      await startMatch(page)
      const first: { snap: SimSnapshot; born: number[] }[] = []
      const known = new Set<number>()
      const snaps = await sample(page, 12_000, 100)
      for (const snap of snaps) {
        const born = snap.enemies.filter((e) => !known.has(e.id)).map((e) => e.id)
        born.forEach((id) => known.add(id))
        if (born.length) first.push({ snap, born })
      }
      expect(first.length).toBeGreaterThan(3)
      for (const { snap, born } of first) {
        for (const id of born) {
          const e = snap.enemies.find((x) => x.id === id)!
          // Allow a couple of steps of movement between the spawn and the sample.
          const fromPlayer = Math.hypot(e.x - snap.player.x, e.y - snap.player.y)
          expect(fromPlayer).toBeGreaterThanOrEqual(spawn.minPlayerDistance - 25)
          expect(e.x).toBeGreaterThan(0)
          expect(e.y).toBeGreaterThan(0)
          for (const island of snap.islands) {
            expect(Math.hypot(e.x - island.x, e.y - island.y)).toBeGreaterThan(island.radius)
          }
        }
      }
      await page.goto('about:blank')
    }
  })

  test('both enemy kinds appear during a default match', async ({ app, page }) => {
    await app.open({ seed: 21 })
    await startMatch(page)
    const kinds = new Set<string>()
    const snaps = await sample(page, 16_000, 250)
    for (const s of snaps) for (const e of s.enemies) kinds.add(e.kind)
    expect([...kinds].sort()).toEqual(['chaser', 'shooter'])
  })
})

test.describe('Chaser', () => {
  test('closes in on the player, hits once for its contact damage, explodes and does not score', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 31, config: { sessionSeconds: 180, spawnIntervalMs: 3_000 } })
    await startMatch(page)

    const outcome = await page.evaluate(() => {
      const game = window.__game!
      const distances: number[] = []
      let tracked: number | null = null
      let last: { x: number; y: number } | null = null
      let prevHealth = game.getSnapshot()!.player.health
      let hit: { drop: number; score: number; gone: boolean } | null = null
      for (let i = 0; i < 2_400 && !hit; i++) {
        game.advance(1000 / 60) // one fixed step, so a Shooter shell cannot land in the same slice
        const snap = game.getSnapshot()!
        if (tracked === null) {
          const c = snap.enemies.find((e) => e.kind === 'chaser')
          if (c) tracked = c.id
        }
        const chaser = snap.enemies.find((e) => e.id === tracked)
        if (chaser) {
          last = { x: chaser.x, y: chaser.y }
          distances.push(Math.hypot(chaser.x - snap.player.x, chaser.y - snap.player.y))
        }
        if (tracked !== null && !chaser) {
          hit = { drop: prevHealth - snap.player.health, score: snap.score, gone: true }
        }
        prevHealth = snap.player.health
      }
      return { distances, hit, last }
    })

    expect(outcome.distances.length).toBeGreaterThan(6)
    // It chases: the distance shrinks over time.
    expect(outcome.distances.at(-1)!).toBeLessThan(outcome.distances[0]! - 80)
    // It reached the ship, disappeared and cost exactly its contact damage.
    expect(outcome.hit?.gone).toBe(true)
    expect(outcome.hit?.drop).toBe(chaser.contactDamage)
    expect(outcome.hit?.score).toBe(0)
  })
})

test.describe('Shooter', () => {
  test('approaches and only fires when the player is inside its attack range', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 21, config: { sessionSeconds: 180, spawnIntervalMs: 3_000 } })
    await startMatch(page)

    const report = await page.evaluate(
      ({ range }) => {
        const game = window.__game!
        const known = new Set<number>()
        const violations: string[] = []
        let closest = Infinity
        let shots = 0
        for (let i = 0; i < 1_200 && game.getHud().phase === 'running'; i++) {
          game.advance(50)
          const snap = game.getSnapshot()!
          const shooters = snap.enemies.filter((e) => e.kind === 'shooter')
          for (const s of shooters) {
            closest = Math.min(closest, Math.hypot(s.x - snap.player.x, s.y - snap.player.y))
          }
          for (const p of snap.projectiles) {
            if (p.owner !== 'enemy' || known.has(p.id)) continue
            known.add(p.id)
            shots += 1
            const nearest = Math.min(
              ...shooters.map((s) => Math.hypot(s.x - snap.player.x, s.y - snap.player.y)),
              Infinity,
            )
            if (nearest > range + 40) violations.push(`shot at distance ${nearest.toFixed(0)}`)
          }
        }
        return { shots, closest, violations }
      },
      { range: shooter.attackRange },
    )

    expect(report.shots).toBeGreaterThan(0)
    expect(report.violations).toEqual([])
    // It closes to (about) its preferred distance rather than sitting at the edge of the range.
    expect(report.closest).toBeLessThan(shooter.preferredDistance + 60)
    expect(player.maxHealth).toBeGreaterThan(0)
  })
})
