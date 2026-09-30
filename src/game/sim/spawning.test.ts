import { describe, expect, it } from 'vitest'
import { DEFAULT_GAMEPLAY } from '../../config/gameplay.ts'
import { maxPlausibleScore } from '../../contracts/match.ts'
import {
  ARENA,
  EMPTY_INPUT,
  type EnemyKind,
  type InputState,
  type Simulation,
} from '../contracts.ts'
import { isClearOfIslands } from './geometry.ts'
import { createDebugSimulation, createSimulation } from './index.ts'
import { createRng } from './rng.ts'
import { input, makeSettings, withGameplay } from './testing.ts'

const SPAWN = DEFAULT_GAMEPLAY.spawn
const RADIUS: Record<EnemyKind, number> = {
  chaser: DEFAULT_GAMEPLAY.chaser.radius,
  shooter: DEFAULT_GAMEPLAY.shooter.radius,
}
const STEPS_PER_SECOND = 60

interface Spawn {
  step: number
  timeMs: number
  id: number
  kind: EnemyKind
  x: number
  y: number
  player: { x: number; y: number }
}

/** Steps the simulation and records each enemy the first time it shows up in a snapshot. */
function collectSpawns(
  sim: Simulation,
  steps: number,
  drive: (step: number) => Readonly<InputState> = () => EMPTY_INPUT,
): Spawn[] {
  const seen = new Set<number>()
  const spawns: Spawn[] = []
  for (let step = 1; step <= steps && !sim.result(); step++) {
    sim.step(drive(step))
    const snap = sim.snapshot()
    for (const e of snap.enemies) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      spawns.push({
        step,
        timeMs: snap.timeMs,
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        player: { x: snap.player.x, y: snap.player.y },
      })
    }
    sim.drainEvents()
  }
  return spawns
}

const immortal = (spawn: object = {}) =>
  withGameplay({ player: { maxHealth: 1e9 }, spawn: { maxEnemies: 999, ...spawn } })

describe('spawn timing', () => {
  it.each([500, 1000, 2500, 3000, 7300, 10_000])(
    'the first enemy appears at t = interval (%i ms), never at t = 0',
    (spawnIntervalMs) => {
      const sim = createSimulation(
        makeSettings(3, { sessionSeconds: 180, spawnIntervalMs }),
        immortal(),
      )
      expect(sim.snapshot().enemies).toHaveLength(0)
      const spawns = collectSpawns(sim, 180 * STEPS_PER_SECOND)
      const first = spawns[0]!
      expect(first.step).toBe((spawnIntervalMs * STEPS_PER_SECOND) / 1000)
      expect(first.timeMs).toBeGreaterThanOrEqual(spawnIntervalMs - 1e-6)
      expect(first.timeMs).toBeLessThan(spawnIntervalMs + 17)
    },
  )

  it('spawns exactly one enemy per tick, on every tick, until the end', () => {
    const config = { sessionSeconds: 60, spawnIntervalMs: 1000 }
    const sim = createSimulation(makeSettings(5, config), immortal())
    const spawns = collectSpawns(sim, 60 * STEPS_PER_SECOND)
    // Tick 60 coincides with the last step of the match, where nothing spawns any more.
    expect(spawns.map((s) => s.step)).toEqual(
      Array.from({ length: 59 }, (_, i) => (i + 1) * STEPS_PER_SECOND),
    )
    expect(new Set(spawns.map((s) => s.id)).size).toBe(spawns.length)
    expect(spawns.length).toBeLessThanOrEqual(maxPlausibleScore(config, 60_000))
  })

  it('never spawns more enemies than the score bound allows (odd interval)', () => {
    const config = { sessionSeconds: 60, spawnIntervalMs: 700 }
    const sim = createSimulation(makeSettings(9, config), immortal())
    const spawns = collectSpawns(sim, 60 * STEPS_PER_SECOND)
    expect(spawns.length).toBeLessThanOrEqual(maxPlausibleScore(config, 60_000))
    expect(spawns.length).toBeGreaterThanOrEqual(maxPlausibleScore(config, 60_000) - 1)
  })

  it('does not spawn anything after the match ended', () => {
    const sim = createDebugSimulation(
      makeSettings(1, { spawnIntervalMs: 500 }),
      withGameplay({ player: { maxHealth: 10 }, spawn: { maxEnemies: 999 } }),
    )
    sim.debug.addEnemy('chaser', sim.snapshot().player.x + 40, sim.snapshot().player.y)
    sim.step(EMPTY_INPUT)
    expect(sim.result()?.endReason).toBe('player_destroyed')
    const enemiesAtEnd = sim.snapshot().enemies.length
    for (let i = 0; i < 300; i++) sim.step(EMPTY_INPUT)
    expect(sim.snapshot().enemies).toHaveLength(enemiesAtEnd)
  })
})

describe('enemy kinds', () => {
  it('both kinds appear early in a default match (shuffle bag guarantee)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const sim = createSimulation(makeSettings(seed), immortal())
      const spawns = collectSpawns(sim, 90 * STEPS_PER_SECOND)
      const firstBag = spawns
        .slice(0, SPAWN.kindWeights.chaser + SPAWN.kindWeights.shooter)
        .map((s) => s.kind)
      expect(new Set(firstBag)).toEqual(new Set(['chaser', 'shooter']))
      const kinds = spawns.map((s) => s.kind)
      const chasers = kinds.filter((k) => k === 'chaser').length
      // 3:2 mix over 29 spawns.
      expect(chasers).toBeGreaterThanOrEqual(15)
      expect(chasers).toBeLessThanOrEqual(19)
    }
  })

  it('honours the configured weights', () => {
    const onlyChasers = createSimulation(
      makeSettings(2, { spawnIntervalMs: 1000 }),
      immortal({ kindWeights: { chaser: 1, shooter: 0 } }),
    )
    expect(new Set(collectSpawns(onlyChasers, 40 * STEPS_PER_SECOND).map((s) => s.kind))).toEqual(
      new Set(['chaser']),
    )
    const onlyShooters = createSimulation(
      makeSettings(2, { spawnIntervalMs: 1000 }),
      immortal({ kindWeights: { chaser: 0, shooter: 2 } }),
    )
    expect(new Set(collectSpawns(onlyShooters, 40 * STEPS_PER_SECOND).map((s) => s.kind))).toEqual(
      new Set(['shooter']),
    )
    const degenerate = createSimulation(
      makeSettings(2, { spawnIntervalMs: 1000 }),
      immortal({ kindWeights: { chaser: 0, shooter: 0 } }),
    )
    expect(new Set(collectSpawns(degenerate, 40 * STEPS_PER_SECOND).map((s) => s.kind))).toEqual(
      new Set(['chaser', 'shooter']),
    )
  })
})

describe('spawn points', () => {
  function randomDriver(seed: number): (step: number) => Readonly<InputState> {
    const rng = createRng(seed ^ 0x9e3779b9)
    let held = input()
    return (step) => {
      if (step % 40 === 1) {
        held = input({
          forward: rng.next() < 0.8,
          turnLeft: rng.next() < 0.35,
          turnRight: rng.next() < 0.35,
        })
      }
      return held
    }
  }

  it('are inside the arena, free of islands and far from the player (many seeds)', () => {
    let total = 0
    for (let seed = 1; seed <= 100; seed++) {
      const sim = createSimulation(
        makeSettings(seed, { sessionSeconds: 60, spawnIntervalMs: 1000 }),
        immortal(),
      )
      const spawns = collectSpawns(sim, 60 * STEPS_PER_SECOND, randomDriver(seed))
      for (const s of spawns) {
        total += 1
        const r = RADIUS[s.kind]
        expect(s.x).toBeGreaterThanOrEqual(r)
        expect(s.x).toBeLessThanOrEqual(ARENA.width - r)
        expect(s.y).toBeGreaterThanOrEqual(r)
        expect(s.y).toBeLessThanOrEqual(ARENA.height - r)
        expect(
          isClearOfIslands(s.x, s.y, r, DEFAULT_GAMEPLAY.islands, SPAWN.islandMargin - 1e-6),
        ).toBe(true)
        // Enemies move between the spawn tick and this snapshot? No: spawning is the last thing of the step.
        expect(Math.hypot(s.x - s.player.x, s.y - s.player.y)).toBeGreaterThanOrEqual(
          SPAWN.minPlayerDistance,
        )
      }
    }
    expect(total).toBeGreaterThan(5000)
  })

  it('use the deterministic fallback when no random candidate is valid', () => {
    for (const overrides of [{ attempts: 0 }, { minPlayerDistance: 5000 }]) {
      for (let seed = 1; seed <= 20; seed++) {
        const sim = createSimulation(
          makeSettings(seed, { spawnIntervalMs: 2000 }),
          immortal(overrides),
        )
        const spawns = collectSpawns(sim, 90 * STEPS_PER_SECOND, randomDriver(seed))
        expect(spawns.length).toBeGreaterThan(10)
        for (const s of spawns) {
          const r = RADIUS[s.kind]
          expect(
            isClearOfIslands(s.x, s.y, r, DEFAULT_GAMEPLAY.islands, SPAWN.islandMargin - 1e-6),
          ).toBe(true)
          expect(s.x).toBeGreaterThanOrEqual(r)
          expect(s.x).toBeLessThanOrEqual(ARENA.width - r)
          expect(s.y).toBeGreaterThanOrEqual(r)
          expect(s.y).toBeLessThanOrEqual(ARENA.height - r)
          // Farthest island-free border point from the player: very far in a 1600x900 arena.
          expect(Math.hypot(s.x - s.player.x, s.y - s.player.y)).toBeGreaterThan(
            SPAWN.minPlayerDistance,
          )
        }
      }
    }
  })

  it('skips the spawn (never spawns on an island) when the whole border is blocked', () => {
    const blocked = immortal({ attempts: 4 })
    const sim = createSimulation(makeSettings(1, { spawnIntervalMs: 500 }), {
      ...blocked,
      islands: [{ x: ARENA.width / 2, y: ARENA.height / 2, radius: 3000 }],
    })
    const spawns = collectSpawns(sim, 30 * STEPS_PER_SECOND)
    expect(spawns).toHaveLength(0)
  })

  it('are reproducible for a seed and differ between seeds', () => {
    const run = (seed: number) =>
      collectSpawns(
        createSimulation(makeSettings(seed, { spawnIntervalMs: 2000 }), immortal()),
        40 * STEPS_PER_SECOND,
      ).map((s) => [s.kind, s.x, s.y])
    expect(run(11)).toEqual(run(11))
    expect(run(11)).not.toEqual(run(12))
  })
})

describe('enemy cap', () => {
  it('never exceeds the cap, and skipped ticks do not create catch-up spawns', () => {
    const sim = createDebugSimulation(
      makeSettings(4, { spawnIntervalMs: 500, sessionSeconds: 120 }),
      immortal({ maxEnemies: 2, kindWeights: { chaser: 0, shooter: 1 } }),
    )
    const spawns: number[] = []
    const seen = new Set<number>()
    const observe = (step: number) => {
      const snap = sim.snapshot()
      expect(snap.enemies.length).toBeLessThanOrEqual(2)
      for (const e of snap.enemies) {
        if (!seen.has(e.id)) {
          seen.add(e.id)
          spawns.push(step)
        }
      }
    }
    let step = 0
    for (; step < 20 * STEPS_PER_SECOND; step++) {
      sim.step(EMPTY_INPUT)
      observe(step + 1)
    }
    expect(spawns).toHaveLength(2) // cap reached: ticks 3.. were skipped, not queued

    // Free one slot in the middle of a tick interval: nothing appears until the next tick.
    sim.debug.world.enemies[0]!.alive = false
    const tickSteps = 30
    let extra = 0
    const freedAt = step
    for (let i = 0; i < tickSteps * 2; i++) {
      sim.step(EMPTY_INPUT)
      step += 1
      const before = seen.size
      observe(step)
      extra += seen.size - before
      if (extra > 0) {
        expect(step % tickSteps).toBe(0) // on a tick boundary
        break
      }
    }
    expect(extra).toBe(1)
    expect(step - freedAt).toBeLessThanOrEqual(tickSteps)
    // And only one: the cap is back at 2.
    for (let i = 0; i < tickSteps * 4; i++) {
      sim.step(EMPTY_INPUT)
      step += 1
      observe(step)
    }
    expect(seen.size).toBe(3)
  })
})
