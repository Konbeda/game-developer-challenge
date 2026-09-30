import { describe, expect, it } from 'vitest'
import { DEFAULT_GAMEPLAY } from '../../config/gameplay.ts'
import { ARENA, type SimEvent } from '../contracts.ts'
import { angleDelta, segmentHitsIsland } from './geometry.ts'
import { createDebugSimulation } from './index.ts'
import { emptySea, input, makeSettings, runSteps, withGameplay } from './testing.ts'
import { DT, msToSteps } from './time.ts'

const { chaser: CHASER, shooter: SHOOTER, player: PLAYER } = DEFAULT_GAMEPLAY
const START = PLAYER.start
const IMMORTAL = { player: { maxHealth: 1e9 } }
const STEPS_PER_SECOND = 60

function ofType<T extends SimEvent['type']>(events: SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
}

describe('chaser', () => {
  it('pursues the player, damages it on impact and explodes without scoring', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addEnemy('chaser', 800, 450, Math.PI)
    const startDistance = 800 - START.x
    runSteps(sim, 30)
    const mid = sim.snapshot().enemies[0]!
    expect(mid.x).toBeLessThan(800)
    expect(Math.hypot(mid.x - START.x, mid.y - START.y)).toBeLessThan(startDistance)

    const events: SimEvent[] = []
    for (let i = 0; i < STEPS_PER_SECOND * 20 && sim.snapshot().enemies.length > 0; i++) {
      sim.step(input())
      events.push(...sim.drainEvents())
    }
    const snap = sim.snapshot()
    expect(snap.enemies).toHaveLength(0)
    expect(snap.player.health).toBe(PLAYER.maxHealth - CHASER.contactDamage)
    expect(snap.score).toBe(0)
    expect(ofType(events, 'enemy_destroyed')).toEqual([
      expect.objectContaining({ kind: 'chaser', byPlayer: false }),
    ])
    expect(ofType(events, 'explosion').filter((e) => e.big)).toHaveLength(1)
    expect(ofType(events, 'hit').filter((h) => h.target === 'player')).toHaveLength(1)
    expect(ofType(events, 'player_damaged')).toEqual([
      { type: 'player_damaged', health: PLAYER.maxHealth - CHASER.contactDamage },
    ])
    // Once exploded it cannot hurt the player again.
    runSteps(sim, 120)
    expect(sim.snapshot().player.health).toBe(PLAYER.maxHealth - CHASER.contactDamage)
    expect(sim.snapshot().score).toBe(0)
  })

  it('turns no faster than its turn rate', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addEnemy('chaser', 800, 450, 0) // facing away from the player
    let previous = 0
    let totalTurn = 0
    for (let i = 0; i < 90; i++) {
      sim.step(input())
      const angle = sim.snapshot().enemies[0]!.angle
      const delta = Math.abs(angleDelta(previous, angle))
      expect(delta).toBeLessThanOrEqual(CHASER.turnRate * DT + 1e-9)
      totalTurn += delta
      previous = angle
    }
    expect(totalTurn).toBeGreaterThan(CHASER.turnRate * DT * 60) // it really was turning
  })

  it('never moves faster than its top speed', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addEnemy('chaser', 1400, 800, Math.PI)
    let previous = { x: 1400, y: 800 }
    for (let i = 0; i < 300; i++) {
      sim.step(input())
      const e = sim.snapshot().enemies[0]
      if (!e) break
      expect(Math.hypot(e.x - previous.x, e.y - previous.y)).toBeLessThanOrEqual(
        CHASER.maxSpeed * DT + 1e-6,
      )
      previous = e
    }
  })

  it.each(['chaser', 'shooter'] as const)(
    'a %s reaches the player from anywhere without crossing islands or borders',
    (kind) => {
      const { islands } = DEFAULT_GAMEPLAY
      const config = withGameplay({ player: { maxHealth: 1e9 }, spawn: { maxEnemies: 0 } })
      const radius = kind === 'chaser' ? CHASER.radius : SHOOTER.radius
      const starts = [
        [60, 60],
        [1540, 60],
        [1540, 840],
        [800, 850],
        [1540, 450],
        [800, 60],
        [1000, 450],
        [700, 650],
        [1100, 450],
        [1350, 450],
      ] as const
      for (const [sx, sy] of starts) {
        const sim = createDebugSimulation(makeSettings(), config)
        // Facing the player, like enemies do when they spawn: the worst case for island avoidance.
        sim.debug.addEnemy(kind, sx, sy, Math.atan2(START.y - sy, START.x - sx))
        let arrived = false
        for (let i = 0; i < STEPS_PER_SECOND * 40 && !arrived; i++) {
          sim.step(input())
          const e = sim.snapshot().enemies[0]
          if (!e) {
            arrived = true // a chaser explodes on the hull and is removed
            break
          }
          expect(e.x).toBeGreaterThanOrEqual(radius - 1e-9)
          expect(e.x).toBeLessThanOrEqual(ARENA.width - radius + 1e-9)
          expect(e.y).toBeGreaterThanOrEqual(radius - 1e-9)
          expect(e.y).toBeLessThanOrEqual(ARENA.height - radius + 1e-9)
          for (const island of islands) {
            expect(Math.hypot(e.x - island.x, e.y - island.y)).toBeGreaterThan(
              island.radius + radius - 1e-6,
            )
          }
          const dist = Math.hypot(e.x - START.x, e.y - START.y)
          arrived = kind === 'shooter' && dist < SHOOTER.preferredDistance + 30
        }
        expect(arrived, `${kind} from ${sx},${sy} did not reach the player`).toBe(true)
      }
    },
  )

  it('separates overlapping enemies instead of stacking them', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea(IMMORTAL))
    sim.debug.addEnemy('chaser', 900, 450, Math.PI)
    sim.debug.addEnemy('chaser', 900, 450, Math.PI)
    runSteps(sim, 5)
    const [a, b] = sim.snapshot().enemies
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThanOrEqual(CHASER.radius * 2 - 1e-6)
  })
})

describe('shooter', () => {
  it('approaches, holds at its preferred distance and fires only in range and aimed', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea(IMMORTAL))
    const shooterId = sim.debug.addEnemy('shooter', 1100, 450, Math.PI)
    const firstShotStep = msToSteps(SHOOTER.initialDelayMs)
    const shots: { step: number; x: number; y: number; angle: number }[] = []
    for (let step = 1; step <= STEPS_PER_SECOND * 12; step++) {
      sim.step(input())
      for (const e of ofType(sim.drainEvents(), 'shot')) {
        if (e.owner === 'enemy') shots.push({ step, x: e.x, y: e.y, angle: e.angle })
      }
    }
    expect(shots.length).toBeGreaterThan(3)
    expect(shots[0]!.step).toBeGreaterThanOrEqual(firstShotStep)
    for (const shot of shots) {
      const dist = Math.hypot(shot.x - START.x, shot.y - START.y)
      expect(dist).toBeLessThanOrEqual(SHOOTER.attackRange + SHOOTER.radius + 20)
      const bearing = Math.atan2(START.y - shot.y, START.x - shot.x)
      expect(Math.abs(angleDelta(shot.angle, bearing))).toBeLessThanOrEqual(
        SHOOTER.aimTolerance + 0.05,
      )
    }
    // Spacing respects the cooldown.
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i]!.step - shots[i - 1]!.step).toBeGreaterThanOrEqual(
        msToSteps(SHOOTER.cooldownMs),
      )
    }
    const shooter = sim.snapshot().enemies.find((e) => e.id === shooterId)!
    const held = Math.hypot(shooter.x - START.x, shooter.y - START.y)
    expect(held).toBeGreaterThan(SHOOTER.preferredDistance - 40)
    expect(held).toBeLessThan(SHOOTER.preferredDistance + 40)
  })

  it('does not fire while the player is out of attack range', () => {
    const sim = createDebugSimulation(
      makeSettings(),
      emptySea({ ...IMMORTAL, shooter: { maxSpeed: 0 } }),
    )
    sim.debug.addEnemy('shooter', START.x + SHOOTER.attackRange + 120, START.y, Math.PI)
    let shots = 0
    for (let i = 0; i < STEPS_PER_SECOND * 8; i++) {
      sim.step(input())
      shots += ofType(sim.drainEvents(), 'shot').length
    }
    expect(shots).toBe(0)
    // Bring the player into range: now it fires.
    sim.debug.world.player.x = START.x + 200
    for (let i = 0; i < STEPS_PER_SECOND * 3; i++) {
      sim.step(input())
      shots += ofType(sim.drainEvents(), 'shot').length
    }
    expect(shots).toBeGreaterThan(0)
  })

  it('does not fire when it is not facing the player', () => {
    const sim = createDebugSimulation(
      makeSettings(),
      emptySea({ ...IMMORTAL, shooter: { turnRate: 0 } }),
    )
    sim.debug.addEnemy('shooter', START.x + 300, START.y, 0) // facing away, cannot turn
    let shots = 0
    for (let i = 0; i < STEPS_PER_SECOND * 6; i++) {
      sim.step(input())
      shots += ofType(sim.drainEvents(), 'shot').length
    }
    expect(shots).toBe(0)
  })

  it('only fires with a clear line of fire and reroutes around a big island', () => {
    const wall = { x: 700, y: 450, radius: 210 }
    const sim = createDebugSimulation(makeSettings(), emptySea({ ...IMMORTAL, islands: [wall] }))
    sim.debug.addEnemy('shooter', 1250, 450, Math.PI)
    let shots = 0
    for (let i = 0; i < STEPS_PER_SECOND * 40; i++) {
      sim.step(input())
      const { player } = sim.snapshot()
      for (const e of ofType(sim.drainEvents(), 'shot')) {
        expect(segmentHitsIsland(e.x, e.y, player.x, player.y, [wall])).toBe(false)
        shots += 1
      }
    }
    expect(shots).toBeGreaterThan(0)
  })

  it('shoots projectiles that damage the player when aimed at a stationary target', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addEnemy('shooter', 700, 450, Math.PI)
    runSteps(sim, STEPS_PER_SECOND * 6)
    expect(sim.snapshot().player.health).toBeLessThan(PLAYER.maxHealth)
    expect(sim.snapshot().player.health % SHOOTER.projectile.damage).toBe(
      PLAYER.maxHealth % SHOOTER.projectile.damage,
    )
  })
})

describe('destroyed enemies', () => {
  it('a chaser killed by a projectile does not damage the player and does score', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addEnemy('chaser', START.x + 30, START.y, Math.PI) // already touching the hull
    sim.debug.world.enemies[0]!.health = 1
    sim.debug.addProjectile('player', START.x + 50, START.y, 0)
    sim.step(input())
    const snap = sim.snapshot()
    expect(snap.enemies).toHaveLength(0)
    expect(snap.player.health).toBe(PLAYER.maxHealth)
    expect(snap.score).toBe(1)
    const events = sim.drainEvents()
    expect(ofType(events, 'enemy_destroyed')).toHaveLength(1)
    expect(ofType(events, 'player_damaged')).toHaveLength(0)
  })

  it('a shooter that is destroyed before its shot never fires', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.addEnemy('shooter', 500, START.y, Math.PI)
    const shooter = sim.debug.world.enemies[0]!
    shooter.nextFireStep = 0 // ready to shoot right now
    shooter.health = 1
    sim.debug.addProjectile('player', 470, START.y, 0) // overlaps its hull
    runSteps(sim, 120)
    expect(ofType(sim.drainEvents(), 'shot').filter((s) => s.owner === 'enemy')).toHaveLength(0)
    expect(sim.snapshot().enemies).toHaveLength(0)
    expect(sim.snapshot().score).toBe(1)
  })

  it('a destroyed enemy no longer collides with projectiles', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea({ chaser: { maxSpeed: 0 } }))
    sim.debug.addEnemy('chaser', 700, START.y)
    sim.debug.world.enemies[0]!.health = 1
    sim.debug.addProjectile('player', 690, START.y, 0) // kills it (starts inside)
    sim.debug.addProjectile('player', 500, START.y, 0) // would have hit the same spot
    runSteps(sim, 60)
    const events = sim.drainEvents()
    expect(ofType(events, 'hit').filter((h) => h.target === 'enemy')).toHaveLength(1)
    expect(sim.snapshot().score).toBe(1)
  })
})
