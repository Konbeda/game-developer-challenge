import { describe, expect, it } from 'vitest'
import { DEFAULT_GAMEPLAY } from '../../config/gameplay.ts'
import { ARENA, FIXED_STEP_MS } from '../contracts.ts'
import { createDebugSimulation, createSimulation } from './index.ts'
import { createRng } from './rng.ts'
import { emptySea, input, makeSettings, runSteps } from './testing.ts'

const PLAYER = DEFAULT_GAMEPLAY.player
const STEPS_PER_SECOND = 1000 / FIXED_STEP_MS

function distanceToIsland(
  p: { x: number; y: number },
  island: { x: number; y: number; radius: number },
): number {
  return Math.hypot(p.x - island.x, p.y - island.y) - island.radius - PLAYER.radius
}

describe('player movement', () => {
  it('starts at the configured pose with full health and does not drift while idle', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, 120)
    const { player, phase, score } = sim.snapshot()
    expect(player.x).toBeCloseTo(PLAYER.start.x)
    expect(player.y).toBeCloseTo(PLAYER.start.y)
    expect(player.angle).toBe(PLAYER.start.angle)
    expect(player.health).toBe(PLAYER.maxHealth)
    expect(player.maxHealth).toBe(PLAYER.maxHealth)
    expect(phase).toBe('running')
    expect(score).toBe(0)
  })

  it('advances along the heading only while forward is held', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, 60, input({ forward: true }))
    const moving = sim.snapshot().player
    expect(moving.x).toBeGreaterThan(PLAYER.start.x + 100)
    expect(moving.y).toBeCloseTo(PLAYER.start.y)

    runSteps(sim, 30) // release: brakes to a stop
    const braked = sim.snapshot().player
    runSteps(sim, 60)
    const later = sim.snapshot().player
    expect(later.x).toBeCloseTo(braked.x, 6)
    expect(later.y).toBeCloseTo(braked.y, 6)
  })

  it('accelerates up to the configured top speed and no further', () => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    runSteps(sim, STEPS_PER_SECOND * 2, input({ forward: true }))
    expect(sim.debug.world.player.speed).toBeCloseTo(PLAYER.maxSpeed)
    // Over one second at full speed the ship covers maxSpeed px (independent of frame rate).
    const before = sim.snapshot().player.x
    runSteps(sim, STEPS_PER_SECOND, input({ forward: true }))
    expect(sim.snapshot().player.x - before).toBeCloseTo(PLAYER.maxSpeed, 3)
  })

  it('rotates clockwise on screen with turnRight and counter-clockwise with turnLeft', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, STEPS_PER_SECOND, input({ turnRight: true }))
    expect(sim.snapshot().player.angle).toBeCloseTo(PLAYER.turnRate, 3)
    runSteps(sim, STEPS_PER_SECOND * 2, input({ turnLeft: true }))
    expect(sim.snapshot().player.angle).toBeCloseTo(-PLAYER.turnRate, 3)
  })

  it('cancels out when both turn keys are held', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, 30, input({ turnLeft: true, turnRight: true }))
    expect(sim.snapshot().player.angle).toBe(PLAYER.start.angle)
  })

  it('moves toward +y (south) at angle pi/2 and toward -x (west) at angle pi', () => {
    const south = createDebugSimulation(makeSettings(), emptySea())
    south.debug.world.player.angle = Math.PI / 2
    runSteps(south, 30, input({ forward: true }))
    expect(south.snapshot().player.y).toBeGreaterThan(PLAYER.start.y + 30)
    expect(south.snapshot().player.x).toBeCloseTo(PLAYER.start.x, 6)

    const west = createDebugSimulation(makeSettings(), emptySea())
    west.debug.world.player.angle = Math.PI
    runSteps(west, 30, input({ forward: true }))
    expect(west.snapshot().player.x).toBeLessThan(PLAYER.start.x - 30)
  })

  it('moves and turns at the same time (curves clockwise on screen)', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, 30, input({ forward: true, turnRight: true }))
    const { player } = sim.snapshot()
    expect(player.x).toBeGreaterThan(PLAYER.start.x)
    expect(player.y).toBeGreaterThan(PLAYER.start.y) // turned toward south
    expect(player.angle).toBeGreaterThan(0)
  })

  it('moves and fires at the same time', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    sim.step(input({ forward: true, fireFront: true, fireLeft: true, fireRight: true }))
    runSteps(sim, 10, input({ forward: true, fireFront: true }))
    const snap = sim.snapshot()
    expect(snap.player.x).toBeGreaterThan(PLAYER.start.x)
    expect(snap.projectiles.length).toBeGreaterThan(0)
  })
})

describe('arena bounds', () => {
  it.each([
    ['east', 0, 'x', ARENA.width - PLAYER.radius],
    ['south', Math.PI / 2, 'y', ARENA.height - PLAYER.radius],
    ['west', Math.PI, 'x', PLAYER.radius],
    ['north', -Math.PI / 2, 'y', PLAYER.radius],
  ] as const)('stops at the %s border', (_name, angle, axis, limit) => {
    const sim = createDebugSimulation(makeSettings(), emptySea())
    sim.debug.world.player.angle = angle
    runSteps(sim, STEPS_PER_SECOND * 12, input({ forward: true }))
    expect(sim.snapshot().player[axis]).toBeCloseTo(limit, 6)
  })

  it('never leaves the arena nor enters an island under random input (default layout)', () => {
    for (const seed of [1, 2, 3]) {
      const sim = createSimulation(makeSettings(seed, { sessionSeconds: 180 }), {
        ...DEFAULT_GAMEPLAY,
        player: { ...PLAYER, maxHealth: 1e9 },
      })
      const rng = createRng(seed * 77)
      let held = input()
      for (let i = 0; i < 12_000; i++) {
        if (i % 25 === 0) {
          held = input({
            forward: rng.next() < 0.85,
            turnLeft: rng.next() < 0.3,
            turnRight: rng.next() < 0.3,
          })
        }
        sim.step(held)
        const { player, islands } = sim.snapshot()
        expect(player.x).toBeGreaterThanOrEqual(PLAYER.radius - 1e-9)
        expect(player.x).toBeLessThanOrEqual(ARENA.width - PLAYER.radius + 1e-9)
        expect(player.y).toBeGreaterThanOrEqual(PLAYER.radius - 1e-9)
        expect(player.y).toBeLessThanOrEqual(ARENA.height - PLAYER.radius + 1e-9)
        for (const island of islands)
          expect(distanceToIsland(player, island)).toBeGreaterThan(-1e-6)
      }
    }
  })
})

describe('island collisions (player)', () => {
  const island = { x: 700, y: 450, radius: 90 }
  const config = () => emptySea({ islands: [island] })

  it('cannot sail through an island, even holding forward for a long time', () => {
    const sim = createDebugSimulation(makeSettings(), config())
    sim.debug.world.player.x = 300
    sim.debug.world.player.y = island.y
    for (let i = 0; i < STEPS_PER_SECOND * 15; i++) {
      sim.step(input({ forward: true }))
      const { player } = sim.snapshot()
      expect(distanceToIsland(player, island)).toBeGreaterThan(-1e-6)
      expect(player.x).toBeLessThan(island.x)
    }
  })

  it('slides along the shore when approaching at an angle', () => {
    const sim = createDebugSimulation(makeSettings(), config())
    sim.debug.world.player.x = 460
    sim.debug.world.player.y = island.y - 100 // aims at the upper part of the island
    let touched = false
    for (let i = 0; i < STEPS_PER_SECOND * 4; i++) {
      sim.step(input({ forward: true }))
      const gap = distanceToIsland(sim.snapshot().player, island)
      expect(gap).toBeGreaterThan(-1e-6)
      touched ||= gap < 1e-6
    }
    // It touched the shore, kept moving along it and ended up past the island.
    expect(touched).toBe(true)
    expect(sim.snapshot().player.x).toBeGreaterThan(island.x + island.radius)
  })

  it('can always turn away and sail off after touching the shore', () => {
    const sim = createDebugSimulation(makeSettings(), config())
    sim.debug.world.player.x = 300
    sim.debug.world.player.y = island.y
    runSteps(sim, STEPS_PER_SECOND * 6, input({ forward: true }))
    const stuckAt = sim.snapshot().player.x
    runSteps(
      sim,
      Math.ceil((Math.PI / PLAYER.turnRate) * STEPS_PER_SECOND),
      input({ turnRight: true }),
    )
    runSteps(sim, STEPS_PER_SECOND * 2, input({ forward: true }))
    const { player } = sim.snapshot()
    expect(stuckAt - player.x).toBeGreaterThan(200)
    expect(distanceToIsland(player, island)).toBeGreaterThan(-1e-6)
  })

  it('is pushed out if it ever ends up inside an island (defensive)', () => {
    const sim = createDebugSimulation(makeSettings(), config())
    sim.debug.world.player.x = island.x
    sim.debug.world.player.y = island.y
    sim.step(input())
    expect(distanceToIsland(sim.snapshot().player, island)).toBeGreaterThan(-1e-6)
  })
})
