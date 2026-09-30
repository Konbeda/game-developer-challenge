import { describe, expect, it } from 'vitest'
import { DEFAULT_GAMEPLAY } from '../../config/gameplay.ts'
import {
  DEFAULT_MATCH_CONFIG,
  matchSubmissionSchema,
  maxPlausibleScore,
  type MatchConfig,
  type MatchResult,
} from '../../contracts/match.ts'
import {
  ARENA,
  EMPTY_INPUT,
  FIXED_STEP_MS,
  type InputState,
  type SimEvent,
  type Simulation,
} from '../contracts.ts'
import { createDebugSimulation, createSimulation } from './index.ts'
import { createRng } from './rng.ts'
import {
  botInput,
  emptySea,
  hashValue,
  input,
  makeSettings,
  playWithBot,
  runSteps,
  withGameplay,
} from './testing.ts'

const { player: PLAYER, chaser: CHASER, shooter: SHOOTER } = DEFAULT_GAMEPLAY
const ALL_KEYS: InputState = {
  forward: true,
  turnLeft: false,
  turnRight: true,
  fireFront: true,
  fireLeft: true,
  fireRight: true,
}
const STEPS_PER_SECOND = 60

function toSubmission(result: MatchResult, config: MatchConfig, seed: number) {
  return {
    matchId: 'match-0001-abcd',
    playerId: 'player-0001-abcd',
    playerName: 'Captain',
    playedAt: '2026-09-29T12:00:00.000Z',
    ...result,
    config,
    seed,
  }
}

describe('match start', () => {
  it('begins running with full health, no score and the fixed layout', () => {
    const sim = createSimulation(makeSettings(42))
    const snap = sim.snapshot()
    expect(snap.phase).toBe('running')
    expect(snap.timeMs).toBe(0)
    expect(snap.score).toBe(0)
    expect(snap.arena).toEqual(ARENA)
    expect(snap.player.health).toBe(PLAYER.maxHealth)
    expect(snap.enemies).toEqual([])
    expect(snap.projectiles).toEqual([])
    expect(snap.islands.length).toBeGreaterThanOrEqual(3)
    expect(snap.islands).toEqual(DEFAULT_GAMEPLAY.islands)
    expect(sim.result()).toBeNull()
    expect(sim.drainEvents()).toEqual([])
  })

  it('advances exactly one fixed step per call', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    runSteps(sim, 600)
    expect(sim.snapshot().timeMs).toBeCloseTo(600 * FIXED_STEP_MS, 9)
    expect(sim.snapshot().timeMs).toBeCloseTo(10_000, 6)
  })

  it('the default layout leaves the player start in free water', () => {
    const { start } = PLAYER
    for (const island of DEFAULT_GAMEPLAY.islands) {
      expect(Math.hypot(start.x - island.x, start.y - island.y)).toBeGreaterThan(
        island.radius + PLAYER.radius + 100,
      )
    }
    expect(start.x).toBeGreaterThan(PLAYER.radius)
    expect(start.y).toBeGreaterThan(PLAYER.radius)
  })

  it('does not mutate the input object it is given', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    const frozen = Object.freeze({ ...ALL_KEYS })
    expect(() => runSteps(sim, 10, frozen)).not.toThrow()
  })

  it('returns snapshots that are copies (mutating one never changes the simulation)', () => {
    const sim = createSimulation(makeSettings())
    sim.step(input({ forward: true }))
    const a = sim.snapshot()
    a.player.x = -999
    a.score = 999
    a.islands.length = 0
    const b = sim.snapshot()
    expect(b).not.toBe(a)
    expect(b.player.x).toBeGreaterThan(0)
    expect(b.score).toBe(0)
    expect(b.islands.length).toBeGreaterThanOrEqual(3)
  })
})

describe('match end', () => {
  it.each([60, 90, 180])('ends by time after exactly %i s of simulated time', (sessionSeconds) => {
    const sim = createSimulation(
      makeSettings(1, { sessionSeconds }),
      emptySea({ player: { maxHealth: 1e9 } }),
    )
    runSteps(sim, sessionSeconds * STEPS_PER_SECOND - 1)
    expect(sim.result()).toBeNull()
    expect(sim.snapshot().phase).toBe('running')
    sim.step(EMPTY_INPUT)
    expect(sim.result()).toEqual({
      score: 0,
      durationMs: sessionSeconds * 1000,
      endReason: 'time_up',
    })
    expect(sim.snapshot().phase).toBe('ended')
  })

  it('ends when the player health reaches zero and reports the play time', () => {
    const sim = createDebugSimulation(
      makeSettings(),
      emptySea({ player: { maxHealth: CHASER.contactDamage } }),
    )
    runSteps(sim, 100)
    expect(sim.result()).toBeNull()
    const { x, y } = sim.snapshot().player
    sim.debug.addEnemy('chaser', x + 40, y)
    sim.step(EMPTY_INPUT)
    const result = sim.result()!
    expect(result.endReason).toBe('player_destroyed')
    expect(result.score).toBe(0)
    expect(result.durationMs).toBe(Math.round(101 * FIXED_STEP_MS))
    expect(sim.snapshot().player.health).toBe(0)
    expect(sim.snapshot().phase).toBe('ended')
    const events = sim.drainEvents()
    expect(events.at(-1)).toEqual({ type: 'match_end', result })
    expect(events.some((e) => e.type === 'explosion' && e.x === x)).toBe(true)
  })

  it('ends when enemy fire kills the player', () => {
    const sim = createDebugSimulation(
      makeSettings(),
      emptySea({ player: { maxHealth: SHOOTER.projectile.damage } }),
    )
    const { x, y } = sim.snapshot().player
    sim.debug.addProjectile('enemy', x + 100, y, Math.PI)
    runSteps(sim, 60)
    expect(sim.result()?.endReason).toBe('player_destroyed')
  })

  it('player_destroyed wins when death and time-up happen in the same step', () => {
    const config = { sessionSeconds: 60 }
    const total = 60 * STEPS_PER_SECOND
    const fatal = createDebugSimulation(
      makeSettings(1, config),
      emptySea({ player: { maxHealth: CHASER.contactDamage } }),
    )
    runSteps(fatal, total - 1)
    expect(fatal.result()).toBeNull()
    const { x, y } = fatal.snapshot().player
    fatal.debug.addEnemy('chaser', x + 40, y) // touches the hull on the very last step
    fatal.step(EMPTY_INPUT)
    expect(fatal.result()).toEqual({ score: 0, durationMs: 60_000, endReason: 'player_destroyed' })

    const survivor = createDebugSimulation(
      makeSettings(1, config),
      emptySea({ player: { maxHealth: CHASER.contactDamage + 1 } }),
    )
    runSteps(survivor, total - 1)
    survivor.debug.addEnemy('chaser', x + 40, y)
    survivor.step(EMPTY_INPUT)
    expect(survivor.result()?.endReason).toBe('time_up')
  })

  it('a chaser exploding on the player never adds score, even on the last step', () => {
    const sim = createDebugSimulation(
      makeSettings(1, { sessionSeconds: 60 }),
      emptySea({ player: { maxHealth: 500 } }),
    )
    runSteps(sim, 60 * STEPS_PER_SECOND - 1)
    const { x, y } = sim.snapshot().player
    sim.debug.addEnemy('chaser', x + 40, y)
    sim.step(EMPTY_INPUT)
    expect(sim.result()).toEqual({ score: 0, durationMs: 60_000, endReason: 'time_up' })
  })

  it('result() is stable and does not alias internal state', () => {
    const sim = createSimulation(
      makeSettings(1, { sessionSeconds: 60 }),
      emptySea({ player: { maxHealth: 1e9 } }),
    )
    runSteps(sim, 60 * STEPS_PER_SECOND)
    const first = sim.result()!
    first.score = 12345
    expect(sim.result()).toEqual({ score: 0, durationMs: 60_000, endReason: 'time_up' })
  })
})

describe('after the match ended', () => {
  function endedSimulation() {
    const sim = createDebugSimulation(
      makeSettings(7, { spawnIntervalMs: 500 }),
      withGameplay({ player: { maxHealth: CHASER.contactDamage } }),
    )
    const events: SimEvent[] = []
    const { x, y } = sim.snapshot().player
    sim.debug.addEnemy('chaser', x + 40, y)
    sim.debug.addEnemy('shooter', x + 300, y, Math.PI)
    sim.debug.addProjectile('player', x + 100, y, 0)
    sim.step(EMPTY_INPUT)
    events.push(...sim.drainEvents())
    return { sim, events }
  }

  it('step is a no-op: no movement, fire, damage, spawns or score', () => {
    const { sim } = endedSimulation()
    expect(sim.result()).not.toBeNull()
    const frozen = JSON.stringify(sim.snapshot())
    const result = sim.result()
    for (let i = 0; i < 1500; i++) sim.step(ALL_KEYS)
    expect(JSON.stringify(sim.snapshot())).toBe(frozen)
    expect(sim.result()).toEqual(result)
    expect(sim.drainEvents()).toEqual([])
  })

  it('emits match_end exactly once', () => {
    const { sim, events } = endedSimulation()
    for (let i = 0; i < 900; i++) {
      sim.step(ALL_KEYS)
      events.push(...sim.drainEvents())
    }
    expect(events.filter((e) => e.type === 'match_end')).toHaveLength(1)
  })

  it('emits match_end exactly once in a full time-limited match too', () => {
    const sim = createSimulation(makeSettings(3), withGameplay({ player: { maxHealth: 1e9 } }))
    const events: SimEvent[] = []
    for (let i = 0; i < 90 * STEPS_PER_SECOND + 500; i++) {
      sim.step(botInput(sim.snapshot()))
      events.push(...sim.drainEvents())
    }
    const ends = events.filter((e) => e.type === 'match_end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toEqual({ type: 'match_end', result: sim.result() })
    // Nothing happens after the final event.
    expect(events.at(-1)).toBe(ends[0])
  })
})

describe('events', () => {
  it('drainEvents returns the pending events and clears them', () => {
    const sim = createSimulation(makeSettings(), emptySea())
    sim.step(input({ fireFront: true }))
    const first = sim.drainEvents()
    expect(first.map((e) => e.type)).toEqual(['shot'])
    expect(sim.drainEvents()).toEqual([])
  })

  it('caps the buffer when the host never drains, but always keeps match_end', () => {
    const sim = createSimulation(
      makeSettings(1, { sessionSeconds: 60 }),
      withGameplay({ player: { maxHealth: 1e9 }, events: { maxBuffered: 50 } }),
    )
    for (let i = 0; i < 60 * STEPS_PER_SECOND; i++) sim.step(ALL_KEYS)
    const events = sim.drainEvents()
    expect(events.length).toBeLessThanOrEqual(51)
    expect(events.at(-1)?.type).toBe('match_end')
  })
})

describe('determinism', () => {
  function scriptedRun(
    seed: number,
    steps: number,
    config = withGameplay({ player: { maxHealth: 400 } }),
  ) {
    const sim = createSimulation(
      makeSettings(seed, { sessionSeconds: 180, spawnIntervalMs: 1000 }),
      config,
    )
    const rng = createRng(seed * 31 + 7)
    let held = input()
    let hash = 0
    let eventHash = 0
    let ended = 0
    for (let i = 0; i < steps; i++) {
      if (i % 20 === 0) {
        held = input({
          forward: rng.next() < 0.7,
          turnLeft: rng.next() < 0.3,
          turnRight: rng.next() < 0.3,
          fireFront: rng.next() < 0.5,
          fireLeft: rng.next() < 0.2,
          fireRight: rng.next() < 0.2,
        })
      }
      sim.step(held)
      hash = hashValue(sim.snapshot(), hash || undefined)
      const events = sim.drainEvents()
      eventHash = hashValue(events, eventHash || undefined)
      if (sim.result()) ended += 1
    }
    return { hash, eventHash, result: sim.result(), ended }
  }

  it('same seed and inputs give identical snapshots and events over thousands of steps', () => {
    for (const seed of [1, 2, 3, 12345, 0xffff_ffff]) {
      const a = scriptedRun(seed, 8000)
      const b = scriptedRun(seed, 8000)
      expect(b).toEqual(a)
    }
  })

  it('different seeds diverge', () => {
    expect(scriptedRun(1, 3000).hash).not.toBe(scriptedRun(2, 3000).hash)
  })

  it('a longer scripted run keeps the world consistent (finite numbers, bounded entities)', () => {
    const sim = createSimulation(
      makeSettings(5, { sessionSeconds: 180, spawnIntervalMs: 500 }),
      withGameplay({ player: { maxHealth: 1e9 } }),
    )
    const cap = DEFAULT_GAMEPLAY.spawn.maxEnemies
    for (let i = 0; i < 180 * STEPS_PER_SECOND; i++) {
      sim.step(botInput(sim.snapshot()))
      sim.drainEvents()
      if (i % 30 === 0) {
        const snap = sim.snapshot()
        expect(snap.enemies.length).toBeLessThanOrEqual(cap)
        expect(snap.projectiles.length).toBeLessThan(200)
        const numbers = [snap.player.x, snap.player.y, snap.player.angle, snap.timeMs]
        for (const e of snap.enemies) numbers.push(e.x, e.y, e.angle, e.health)
        for (const p of snap.projectiles) numbers.push(p.x, p.y, p.angle)
        expect(numbers.every(Number.isFinite)).toBe(true)
      }
    }
    expect(sim.result()?.endReason).toBe('time_up')
  })
})

describe('headless bot', () => {
  it('plays a full default match: scores, respects the score bound, valid submission', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = createSimulation(makeSettings(seed))
      const result = playWithBot(sim)
      expect(result.score).toBeGreaterThan(0)
      expect(result.score).toBeLessThanOrEqual(
        maxPlausibleScore(DEFAULT_MATCH_CONFIG, result.durationMs),
      )
      expect(result.endReason).toBe('time_up')
      expect(result.durationMs).toBe(90_000)
      const parsed = matchSubmissionSchema.safeParse(
        toSubmission(result, DEFAULT_MATCH_CONFIG, seed),
      )
      expect(parsed.success).toBe(true)
    }
  })

  it('keeps the score bound and produces valid results under heavy spawning (dies early)', () => {
    for (const spawnIntervalMs of [500, 1000, 2000]) {
      for (const seed of [1, 2, 3]) {
        const config = { sessionSeconds: 60, spawnIntervalMs }
        const sim = createSimulation(makeSettings(seed, config))
        const result = playWithBot(sim)
        expect(result.score).toBeLessThanOrEqual(maxPlausibleScore(config, result.durationMs))
        expect(Number.isInteger(result.durationMs)).toBe(true)
        expect(matchSubmissionSchema.safeParse(toSubmission(result, config, seed)).success).toBe(
          true,
        )
      }
    }
  })

  it('an idle player does not survive a default match (not immortal)', () => {
    for (const seed of [1, 2, 3]) {
      const sim = createSimulation(makeSettings(seed))
      runSteps(sim, 90 * STEPS_PER_SECOND)
      expect(sim.result()?.endReason).toBe('player_destroyed')
      expect(sim.result()?.score).toBe(0)
    }
  })

  it('stays fast: a 3-minute match at 500 ms spawn interval', () => {
    const sim = createSimulation(
      makeSettings(9, { sessionSeconds: 180, spawnIntervalMs: 500 }),
      withGameplay({ player: { maxHealth: 1e9 } }),
    )
    const started = performance.now()
    let peakEnemies = 0
    let peakProjectiles = 0
    for (let i = 0; i < 180 * STEPS_PER_SECOND; i++) {
      const snap = sim.snapshot()
      peakEnemies = Math.max(peakEnemies, snap.enemies.length)
      peakProjectiles = Math.max(peakProjectiles, snap.projectiles.length)
      sim.step(botInput(snap))
      sim.drainEvents()
    }
    const elapsed = performance.now() - started
    expect(sim.result()).not.toBeNull()
    expect(peakEnemies).toBeLessThanOrEqual(DEFAULT_GAMEPLAY.spawn.maxEnemies)
    expect(elapsed).toBeLessThan(5000) // generous CI bound; typically well under 500 ms
  })
})

// Guards the exported interface shape used by the host.
describe('Simulation interface', () => {
  it('exposes exactly the contract methods', () => {
    const sim: Simulation = createSimulation(makeSettings())
    expect(Object.keys(sim).sort()).toEqual(['drainEvents', 'result', 'snapshot', 'step'])
  })
})
