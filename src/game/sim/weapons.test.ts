import { describe, expect, it } from 'vitest'
import { DEFAULT_GAMEPLAY } from '../../config/gameplay.ts'
import type { SimEvent } from '../contracts.ts'
import { createDebugSimulation, createSimulation } from './index.ts'
import { emptySea, input, makeSettings, runSteps } from './testing.ts'
import { msToSteps } from './time.ts'

const PLAYER = DEFAULT_GAMEPLAY.player
const MUZZLE = PLAYER.radius + PLAYER.muzzleClearance

function ofType<T extends SimEvent['type']>(events: SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
}

describe('front cannon', () => {
  it('fires exactly one projectile from the bow along the heading', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.world.player.angle = 0.7
    sim.step(input({ fireFront: true }))
    const { projectiles, player } = sim.snapshot()
    expect(projectiles).toHaveLength(1)
    const p = projectiles[0]!
    expect(p.owner).toBe('player')
    expect(p.angle).toBeCloseTo(0.7)
    expect(p.x).toBeCloseTo(player.x + Math.cos(0.7) * MUZZLE)
    expect(p.y).toBeCloseTo(player.y + Math.sin(0.7) * MUZZLE)
    const shots = ofType(sim.drainEvents(), 'shot')
    expect(shots).toHaveLength(1)
    expect(shots[0]).toMatchObject({ owner: 'player' })
  })

  it('travels at the configured speed', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    sim.step(input({ fireFront: true }))
    const x0 = sim.snapshot().projectiles[0]!.x
    runSteps(sim, 60)
    const p = sim.snapshot().projectiles[0]!
    expect(p.x - x0).toBeCloseTo(PLAYER.frontCannon.projectile.speed, 3)
  })
})

describe('broadsides', () => {
  it.each([
    ['right', 'fireRight', 1],
    ['left', 'fireLeft', -1],
  ] as const)(
    '%s broadside fires three parallel projectiles perpendicular to the hull',
    (_n, key, side) => {
      for (const heading of [0, 0.7, -2.2]) {
        const sim = createDebugSimulation(makeSettings(), emptySea())
        sim.debug.world.player.angle = heading
        sim.step(input({ [key]: true }))
        const { projectiles, player } = sim.snapshot()
        expect(projectiles).toHaveLength(PLAYER.broadside.shotsPerSide)
        expect(ofType(sim.drainEvents(), 'shot')).toHaveLength(PLAYER.broadside.shotsPerSide)

        const shotAngle = heading + (side * Math.PI) / 2
        const hull = { x: Math.cos(heading), y: Math.sin(heading) }
        const out = { x: Math.cos(shotAngle), y: Math.sin(shotAngle) }
        const along = projectiles.map((p) => (p.x - player.x) * hull.x + (p.y - player.y) * hull.y)
        const across = projectiles.map((p) => (p.x - player.x) * out.x + (p.y - player.y) * out.y)
        for (const p of projectiles) {
          // Parallel: all share the same direction, perpendicular to the heading.
          expect(Math.cos(p.angle)).toBeCloseTo(Math.cos(shotAngle))
          expect(Math.sin(p.angle)).toBeCloseTo(Math.sin(shotAngle))
        }
        // Same distance from the hull axis, evenly spread along the hull, centred on the ship.
        for (const value of across) expect(value).toBeCloseTo(MUZZLE)
        const sorted = [...along].sort((a, b) => a - b)
        expect(sorted[0]).toBeCloseTo(-PLAYER.broadside.shotSpacing)
        expect(sorted[1]).toBeCloseTo(0)
        expect(sorted[2]).toBeCloseTo(PLAYER.broadside.shotSpacing)
      }
    },
  )

  it('right broadside goes south and left broadside north when facing east', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    sim.step(input({ fireRight: true, fireLeft: true }))
    const before = sim.snapshot()
    runSteps(sim, 20)
    const after = sim.snapshot()
    const south = after.projectiles.filter((p) => p.y > before.player.y)
    const north = after.projectiles.filter((p) => p.y < before.player.y)
    expect(south).toHaveLength(PLAYER.broadside.shotsPerSide)
    expect(north).toHaveLength(PLAYER.broadside.shotsPerSide)
    for (const p of after.projectiles) expect(Math.abs(p.x - before.player.x)).toBeLessThan(30)
  })
})

describe('cooldowns', () => {
  it('enforces the front cannon cooldown while the key is held', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    const cooldownSteps = msToSteps(PLAYER.frontCannon.cooldownMs)
    const total = cooldownSteps * 10
    let shots = 0
    const shotSteps: number[] = []
    for (let i = 0; i < total; i++) {
      sim.step(input({ fireFront: true }))
      const n = ofType(sim.drainEvents(), 'shot').length
      if (n > 0) shotSteps.push(i)
      shots += n
    }
    expect(shots).toBe(10)
    for (let i = 1; i < shotSteps.length; i++) {
      expect(shotSteps[i]! - shotSteps[i - 1]!).toBe(cooldownSteps)
    }
  })

  it('enforces the broadside cooldown per side', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    const cooldownSteps = msToSteps(PLAYER.broadside.cooldownMs)
    let volleys = 0
    for (let i = 0; i < cooldownSteps * 3; i++) {
      sim.step(input({ fireRight: true }))
      volleys += ofType(sim.drainEvents(), 'shot').length / PLAYER.broadside.shotsPerSide
    }
    expect(volleys).toBe(3)
  })

  it('keeps front, left and right cooldowns independent', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    sim.step(input({ fireFront: true }))
    expect(ofType(sim.drainEvents(), 'shot')).toHaveLength(1)
    // Front is cooling down but the broadsides are still ready.
    sim.step(input({ fireFront: true, fireLeft: true }))
    expect(ofType(sim.drainEvents(), 'shot')).toHaveLength(PLAYER.broadside.shotsPerSide)
    sim.step(input({ fireFront: true, fireLeft: true, fireRight: true }))
    expect(ofType(sim.drainEvents(), 'shot')).toHaveLength(PLAYER.broadside.shotsPerSide)
    // Nothing is ready until the front cooldown elapses (front is the shortest).
    runSteps(
      sim,
      msToSteps(PLAYER.frontCannon.cooldownMs) - 3, // steps 4..21 while the front fires at step 22
      input({ fireFront: true, fireLeft: true, fireRight: true }),
    )
    expect(ofType(sim.drainEvents(), 'shot')).toHaveLength(0)
    sim.step(input({ fireFront: true, fireLeft: true, fireRight: true }))
    expect(ofType(sim.drainEvents(), 'shot')).toHaveLength(1)
  })

  it('does not fire without input', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, 300)
    expect(sim.snapshot().projectiles).toHaveLength(0)
    expect(sim.drainEvents()).toHaveLength(0)
  })
})

describe('projectile damage and targets', () => {
  const stationaryChaser = () => emptySea({ chaser: { maxSpeed: 0 } })

  it('applies damage exactly once and removes the projectile', () => {
    const sim = createDebugSimulation(makeSettings(), stationaryChaser())
    const id = sim.debug.addEnemy('chaser', 600, 450)
    // A second enemy stacked on the first one must not be hit by the same projectile.
    const other = sim.debug.addEnemy('chaser', 600, 450)
    sim.debug.addProjectile('player', 560, 450, 0)
    runSteps(sim, 40)
    const snap = sim.snapshot()
    const damage = PLAYER.frontCannon.projectile.damage
    const healths = snap.enemies.map((e) => e.health).sort()
    expect(snap.enemies.map((e) => e.id).sort()).toEqual([id, other].sort())
    expect(healths).toEqual([
      DEFAULT_GAMEPLAY.chaser.health - damage,
      DEFAULT_GAMEPLAY.chaser.health,
    ])
    expect(snap.projectiles).toHaveLength(0)
    const hits = ofType(sim.drainEvents(), 'hit')
    expect(hits.filter((h) => h.target === 'enemy')).toHaveLength(1)
  })

  it('kills an enemy after enough hits, scores exactly once and emits destruction events', () => {
    const sim = createDebugSimulation(makeSettings(), stationaryChaser())
    sim.debug.addEnemy('chaser', 600, 450)
    const hitsToKill = Math.ceil(
      DEFAULT_GAMEPLAY.chaser.health / PLAYER.frontCannon.projectile.damage,
    )
    for (let i = 0; i < hitsToKill; i++) {
      sim.debug.addProjectile('player', 560 - i * 8, 450, 0)
    }
    runSteps(sim, 30)
    const snap = sim.snapshot()
    expect(snap.enemies).toHaveLength(0)
    expect(snap.score).toBe(1)
    const events = sim.drainEvents()
    expect(ofType(events, 'enemy_destroyed')).toEqual([
      expect.objectContaining({ kind: 'chaser', byPlayer: true }),
    ])
    expect(ofType(events, 'explosion').some((e) => e.big)).toBe(true)
    runSteps(sim, 120)
    expect(sim.snapshot().score).toBe(1)
  })

  it('never hurts the player with its own projectiles (no friendly fire)', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    const { x, y } = sim.snapshot().player
    sim.debug.addProjectile('player', x + 120, y, Math.PI) // flies straight through the player
    runSteps(sim, 40)
    expect(sim.snapshot().player.health).toBe(PLAYER.maxHealth)
    expect(ofType(sim.drainEvents(), 'hit')).toHaveLength(0)
  })

  it('enemy projectiles pass through other enemies without damaging them', () => {
    const sim = createDebugSimulation(makeSettings(), stationaryChaser())
    sim.debug.addEnemy('chaser', 600, 300)
    sim.debug.addProjectile('enemy', 500, 300, 0)
    runSteps(sim, 30)
    const snap = sim.snapshot()
    expect(snap.enemies[0]!.health).toBe(DEFAULT_GAMEPLAY.chaser.health)
    expect(snap.score).toBe(0)
    expect(ofType(sim.drainEvents(), 'hit').filter((h) => h.target === 'enemy')).toHaveLength(0)
  })

  it('enemy projectiles damage the player once', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    const { x, y } = sim.snapshot().player
    sim.debug.addProjectile('enemy', x + 200, y, Math.PI)
    runSteps(sim, 60)
    const snap = sim.snapshot()
    expect(snap.player.health).toBe(PLAYER.maxHealth - DEFAULT_GAMEPLAY.shooter.projectile.damage)
    expect(snap.projectiles).toHaveLength(0)
    const events = sim.drainEvents()
    expect(ofType(events, 'hit').filter((h) => h.target === 'player')).toHaveLength(1)
    expect(ofType(events, 'player_damaged')).toEqual([
      { type: 'player_damaged', health: snap.player.health },
    ])
  })

  it('player projectiles are not affected by the enemies behind an island', () => {
    const island = { x: 500, y: 450, radius: 50 }
    const sim = createDebugSimulation(
      makeSettings(),
      emptySea({ islands: [island], chaser: { maxSpeed: 0 } }),
    )
    sim.debug.addEnemy('chaser', 700, 450)
    sim.debug.addProjectile('player', 300, 450, 0)
    runSteps(sim, 60)
    const snap = sim.snapshot()
    expect(snap.projectiles).toHaveLength(0)
    expect(snap.enemies[0]!.health).toBe(DEFAULT_GAMEPLAY.chaser.health)
    const hits = ofType(sim.drainEvents(), 'hit')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.target).toBe('island')
    expect(hits[0]!.x).toBeLessThan(island.x)
  })
})

describe('projectile lifetime', () => {
  it('expires after its maximum range without hitting anything', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    const { range, speed } = PLAYER.frontCannon.projectile
    sim.debug.addProjectile('player', 100, 450, 0)
    const lifetimeSteps = Math.ceil(range / speed / (1 / 60))
    runSteps(sim, lifetimeSteps - 3)
    expect(sim.snapshot().projectiles).toHaveLength(1)
    runSteps(sim, 6)
    expect(sim.snapshot().projectiles).toHaveLength(0)
    expect(ofType(sim.drainEvents(), 'hit')).toHaveLength(0)
  })

  it('is removed when it leaves the arena', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addProjectile('player', 1560, 450, 0)
    runSteps(sim, 10)
    expect(sim.snapshot().projectiles).toHaveLength(0)
  })
})

describe('swept collision (no tunnelling)', () => {
  const fast = {
    player: { frontCannon: { projectile: { speed: 6000, radius: 1, range: 5000 } } },
  }

  it('hits a thin island even when moving 100 px per step', () => {
    const island = { x: 500, y: 450, radius: 4 }
    const sim = createDebugSimulation(makeSettings(), emptySea({ ...fast, islands: [island] }))
    sim.debug.addProjectile('player', 305, 450, 0)
    runSteps(sim, 4)
    const events = sim.drainEvents()
    expect(ofType(events, 'hit').map((h) => h.target)).toEqual(['island'])
    expect(sim.snapshot().projectiles).toHaveLength(0)
  })

  it('hits a tiny static enemy that lies inside a single step of travel', () => {
    const sim = createDebugSimulation(
      makeSettings(),
      emptySea({ ...fast, chaser: { maxSpeed: 0, radius: 3 } }),
    )
    sim.debug.addEnemy('chaser', 700, 450)
    sim.debug.addProjectile('player', 305, 450, 0)
    runSteps(sim, 6)
    const events = sim.drainEvents()
    expect(ofType(events, 'hit').map((h) => h.target)).toEqual(['enemy'])
    expect(sim.snapshot().enemies[0]!.health).toBe(
      DEFAULT_GAMEPLAY.chaser.health - PLAYER.frontCannon.projectile.damage,
    )
  })

  it('a projectile born inside an island is destroyed at once', () => {
    const island = { x: 400, y: 450, radius: 100 }
    const sim = createDebugSimulation(makeSettings(), emptySea({ islands: [island] }))
    sim.debug.addProjectile('player', 400, 450, 0)
    sim.step(input())
    expect(sim.snapshot().projectiles).toHaveLength(0)
    expect(ofType(sim.drainEvents(), 'hit').map((h) => h.target)).toEqual(['island'])
  })
})
