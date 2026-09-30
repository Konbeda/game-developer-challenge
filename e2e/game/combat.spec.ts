import { DEFAULT_GAMEPLAY } from '../../src/config/gameplay.ts'
import { ARENA, FIXED_STEP_MS, type SimSnapshot } from '../../src/game/contracts.ts'
import { advance, expect, snapshot, startMatch, test } from '../support/index.ts'
import { angleDiff, KEYS, sample } from './helpers.ts'

// README item 4: front and broadside fire, damage, cooldown and scoring without duplication.

const { player } = DEFAULT_GAMEPLAY
// Slow spawns: no enemy interferes with the shots measured in the first ten seconds.
const QUIET = { sessionSeconds: 180, spawnIntervalMs: 10_000 }

const playerShots = (s: SimSnapshot) => s.projectiles.filter((p) => p.owner === 'player')

/** Taps a key for exactly one simulation step and returns the snapshot right after it. */
async function tap(page: Parameters<typeof advance>[0], key: string): Promise<SimSnapshot> {
  await page.keyboard.down(key)
  await advance(page, FIXED_STEP_MS * 1.5)
  await page.keyboard.up(key)
  return snapshot(page)
}

test.describe('Weapons', () => {
  test.beforeEach(async ({ app, page }) => {
    await app.open({ seed: 5, config: QUIET })
    await startMatch(page)
  })

  test('the front cannon fires one shell straight ahead', async ({ page }) => {
    const before = await snapshot(page)
    const after = await tap(page, KEYS.front)
    const shots = playerShots(after)
    expect(shots).toHaveLength(1)
    expect(angleDiff(shots[0]!.angle, before.player.angle)).toBeCloseTo(0, 2)
    // It travels away from the ship along its heading.
    await advance(page, 200)
    const later = playerShots(await snapshot(page))[0]!
    expect(later.x).toBeGreaterThan(shots[0]!.x + 60)
    expect(later.y).toBeCloseTo(shots[0]!.y, 0)
  })

  test('each broadside fires three parallel shells, perpendicular to the ship, on its own side', async ({
    page,
  }) => {
    const start = await snapshot(page)
    const port = playerShots(await tap(page, KEYS.portBroadside))
    expect(port).toHaveLength(DEFAULT_GAMEPLAY.player.broadside.shotsPerSide)
    for (const shell of port) {
      // Ship faces east: port (left) is north = -90 degrees.
      expect(angleDiff(shell.angle, start.player.angle - Math.PI / 2)).toBeCloseTo(0, 2)
    }
    // Parallel shells spread along the hull (same y offset direction, distinct x).
    const xs = port.map((s) => s.x).sort((a, b) => a - b)
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(3)
    expect(xs[1]! - xs[0]!).toBeCloseTo(DEFAULT_GAMEPLAY.player.broadside.shotSpacing, 0)
    expect(xs[2]! - xs[1]!).toBeCloseTo(DEFAULT_GAMEPLAY.player.broadside.shotSpacing, 0)

    await advance(page, 1_600) // let the port cooldown finish and shells clear
    const starboard = playerShots(await tap(page, KEYS.starboardBroadside))
    expect(starboard).toHaveLength(3)
    for (const shell of starboard) {
      expect(angleDiff(shell.angle, start.player.angle + Math.PI / 2)).toBeCloseTo(0, 2)
    }
  })

  test('the three weapons have independent cooldowns', async ({ page }) => {
    await page.keyboard.down(KEYS.front)
    await page.keyboard.down(KEYS.portBroadside)
    await page.keyboard.down(KEYS.starboardBroadside)
    await advance(page, FIXED_STEP_MS * 1.5)
    const first = await snapshot(page)
    // 1 front + 3 port + 3 starboard on the very first step.
    expect(playerShots(first)).toHaveLength(7)
    await page.keyboard.up(KEYS.front)
    await page.keyboard.up(KEYS.portBroadside)
    await page.keyboard.up(KEYS.starboardBroadside)
  })

  test('holding a weapon respects its cooldown (no extra shells)', async ({ page }) => {
    const ids = new Set<number>()
    await page.keyboard.down(KEYS.front)
    const samples = await sample(page, 1_000, FIXED_STEP_MS)
    await page.keyboard.up(KEYS.front)
    for (const s of samples) for (const p of playerShots(s)) ids.add(p.id)
    const cooldown = player.frontCannon.cooldownMs
    const expected = Math.floor(1_000 / cooldown) + 1
    expect(ids.size).toBeGreaterThanOrEqual(expected - 1)
    expect(ids.size).toBeLessThanOrEqual(expected)

    // Tapping again before the cooldown elapsed does nothing; after it, it fires.
    await advance(page, 4_000)
    await tap(page, KEYS.front)
    await advance(page, cooldown / 2)
    const early = await tap(page, KEYS.front)
    const earlyIds = new Set(playerShots(early).map((p) => p.id))
    await advance(page, cooldown)
    const late = await tap(page, KEYS.front)
    const lateIds = new Set(playerShots(late).map((p) => p.id))
    expect([...lateIds].some((id) => !earlyIds.has(id))).toBe(true)
    expect(earlyIds.size).toBeLessThanOrEqual(1)
  })
})

test.describe('Shell lifetimes', () => {
  test('a shell that hits an island disappears at the island', async ({ app, page }) => {
    await app.open({ seed: 5, config: QUIET })
    await startMatch(page)
    // Facing east at y = 450 the central island is ~560 px away, within shell range.
    await tap(page, KEYS.front)
    const samples = await sample(page, 1_500, FIXED_STEP_MS)
    const island = samples[0]!.islands.reduce((best, i) =>
      Math.abs(i.y - 450) < Math.abs(best.y - 450) ? i : best,
    )
    const seen = samples.flatMap((s) => playerShots(s))
    expect(seen.length).toBeGreaterThan(0)
    const maxX = Math.max(...seen.map((p) => p.x))
    expect(maxX).toBeLessThanOrEqual(island.x - island.radius + 12)
    expect(playerShots(samples.at(-1)!)).toHaveLength(0)
  })

  test('shells fired out to sea are removed on expiry or when they leave the arena', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 5, config: QUIET })
    await startMatch(page)
    await page.keyboard.down(KEYS.left)
    await advance(page, Math.ceil((Math.PI / 2 / player.turnRate) * 1000))
    await page.keyboard.up(KEYS.left)
    await tap(page, KEYS.front) // north, a free lane
    const samples = await sample(page, 2_500, FIXED_STEP_MS)
    const seen = samples.flatMap(playerShots)
    expect(seen.length).toBeGreaterThan(0)
    // Never rendered outside the arena, and gone by the end.
    for (const p of seen) {
      expect(p.y).toBeGreaterThanOrEqual(-20)
      expect(p.x).toBeGreaterThanOrEqual(-20)
      expect(p.x).toBeLessThanOrEqual(ARENA.width + 20)
    }
    expect(playerShots(samples.at(-1)!)).toHaveLength(0)
  })
})

test.describe('Damage and scoring', () => {
  test('sinking enemies scores exactly one point each, hits never apply twice', async ({
    app,
    page,
  }) => {
    await app.open({ seed: 7, config: { sessionSeconds: 180, spawnIntervalMs: 3_000 } })
    await startMatch(page)

    // A tiny auto-aim pilot using the REAL keyboard: face the nearest enemy and hold the front cannon.
    const result = await page.evaluate(() => {
      const game = window.__game!
      const held = new Set<string>()
      const set = (code: string, down: boolean) => {
        if (down === held.has(code)) return
        if (down) held.add(code)
        else held.delete(code)
        window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }))
      }
      const norm = (a: number) => {
        let v = a
        while (v > Math.PI) v -= 2 * Math.PI
        while (v < -Math.PI) v += 2 * Math.PI
        return v
      }
      const lastSeen = new Map<number, { health: number; x: number; y: number; kind: string }>()
      const removed: { id: number; health: number; nearPlayer: boolean }[] = []
      const healthDrops: number[] = []
      let prev = game.getSnapshot()!
      let maxScoreJump = 0
      for (let i = 0; i < 1_500 && game.getHud().phase === 'running'; i++) {
        const snap = game.getSnapshot()!
        let target: (typeof snap.enemies)[number] | null = null
        let best = Infinity
        for (const e of snap.enemies) {
          const d = Math.hypot(e.x - snap.player.x, e.y - snap.player.y)
          if (d < best) {
            best = d
            target = e
          }
        }
        if (target) {
          const diff = norm(
            Math.atan2(target.y - snap.player.y, target.x - snap.player.x) - snap.player.angle,
          )
          set('KeyD', diff > 0.05)
          set('KeyA', diff < -0.05)
          set('Space', Math.abs(diff) < 0.2)
        } else {
          set('KeyD', false)
          set('KeyA', false)
          set('Space', false)
        }
        game.advance(50)
        const next = game.getSnapshot()!
        for (const e of next.enemies) {
          const old = lastSeen.get(e.id)
          if (old && e.health < old.health) healthDrops.push(old.health - e.health)
          lastSeen.set(e.id, { health: e.health, x: e.x, y: e.y, kind: e.kind })
        }
        const alive = new Set(next.enemies.map((e) => e.id))
        for (const [id, info] of lastSeen) {
          if (!alive.has(id)) {
            removed.push({
              id,
              health: info.health,
              nearPlayer: Math.hypot(info.x - next.player.x, info.y - next.player.y) < 70,
            })
            lastSeen.delete(id)
          }
        }
        maxScoreJump = Math.max(maxScoreJump, next.score - prev.score)
        prev = next
      }
      for (const code of [...held]) set(code, false)
      return { score: prev.score, removed, healthDrops, maxScoreJump }
    })

    const kills = result.removed.filter((r) => !r.nearPlayer)
    // Every enemy that disappeared away from the player was shot down; each is worth exactly 1 point.
    expect(result.score).toBe(kills.length)
    expect(result.score).toBeGreaterThan(0)
    // Damage arrives in whole shells (20 each), never a partial or repeated amount.
    for (const drop of result.healthDrops)
      expect(drop % player.frontCannon.projectile.damage).toBe(0)
    // Points come in ones.
    expect(result.maxScoreJump).toBeLessThanOrEqual(1)
  })
})
