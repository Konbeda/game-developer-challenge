import { DEFAULT_GAMEPLAY, type GameplayConfig } from '../../config/gameplay.ts'
import { DEFAULT_MATCH_CONFIG, type MatchConfig, type MatchResult } from '../../contracts/match.ts'
import {
  EMPTY_INPUT,
  type InputState,
  type MatchSettings,
  type SimSnapshot,
  type Simulation,
} from '../contracts.ts'
import { angleDelta, HALF_PI } from './geometry.ts'

/** Helpers for tests and headless tooling (balance experiments). Not used by the game itself. */

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    const next = patch[key]
    const current = base[key]
    if (isPlainObject(next) && isPlainObject(current)) mergeInto(current, next)
    else base[key] = next
  }
}

/** Deep-merges overrides over the default tuning (returns a fresh object, arrays are replaced). */
export function withGameplay(overrides: DeepPartial<GameplayConfig> = {}): GameplayConfig {
  const copy = structuredClone(DEFAULT_GAMEPLAY) as unknown as Record<string, unknown>
  mergeInto(copy, overrides as Record<string, unknown>)
  return copy as unknown as GameplayConfig
}

/** Tuning with no islands and no spawns: an empty sea where tests stage their own scenario. */
export function emptySea(overrides: DeepPartial<GameplayConfig> = {}): GameplayConfig {
  return withGameplay({
    ...overrides,
    islands: overrides.islands ?? [],
    spawn: { maxEnemies: 0, ...overrides.spawn },
  })
}

export function makeSettings(seed = 1, config: Partial<MatchConfig> = {}): MatchSettings {
  return { seed, config: { ...DEFAULT_MATCH_CONFIG, ...config } }
}

export function input(patch: Partial<InputState> = {}): InputState {
  return { ...EMPTY_INPUT, ...patch }
}

export function runSteps(
  sim: Simulation,
  count: number,
  held: Readonly<InputState> = EMPTY_INPUT,
): void {
  for (let i = 0; i < count; i++) sim.step(held)
}

/** 32-bit FNV-1a hash of a value's JSON, for cheap determinism comparisons (chain it via `seed`). */
export function hashValue(value: unknown, seed = 0x811c9dc5): number {
  const text = JSON.stringify(value)
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

const BOT_FRONT_TOLERANCE = 0.06
const BOT_BROADSIDE_TOLERANCE = 0.1
const BOT_TURN_DEADZONE = 0.03
const BOT_KEEP_DISTANCE = 200
const BOT_FRONT_RANGE = 640
const BOT_BROADSIDE_RANGE = 480

/**
 * A simple headless "player": aims the nearest enemy with whichever gun needs the least turning
 * (front cannon or a broadside), fires when lined up and closes in when far. Reads snapshots only.
 */
export function botInput(snapshot: SimSnapshot): InputState {
  const { player, enemies } = snapshot
  let target: SimSnapshot['enemies'][number] | null = null
  let best = Infinity
  for (const enemy of enemies) {
    const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y)
    if (dist < best) {
      best = dist
      target = enemy
    }
  }
  if (!target) {
    const toCenter = Math.atan2(
      snapshot.arena.height / 2 - player.y,
      snapshot.arena.width / 2 - player.x,
    )
    const delta = angleDelta(player.angle, toCenter)
    return input({
      turnRight: delta > BOT_TURN_DEADZONE,
      turnLeft: delta < -BOT_TURN_DEADZONE,
      forward:
        Math.hypot(snapshot.arena.width / 2 - player.x, snapshot.arena.height / 2 - player.y) >
        BOT_KEEP_DISTANCE,
    })
  }

  const bearing = Math.atan2(target.y - player.y, target.x - player.x)
  const front = angleDelta(player.angle, bearing)
  const starboard = angleDelta(player.angle + HALF_PI, bearing)
  const port = angleDelta(player.angle - HALF_PI, bearing)

  // Turn so that the gun needing the least rotation points at the target.
  const turnNeeded = [front, starboard, port]
  let turn = front
  for (const candidate of turnNeeded) if (Math.abs(candidate) < Math.abs(turn)) turn = candidate

  return input({
    turnRight: turn > BOT_TURN_DEADZONE,
    turnLeft: turn < -BOT_TURN_DEADZONE,
    forward: best > BOT_KEEP_DISTANCE,
    fireFront: Math.abs(front) < BOT_FRONT_TOLERANCE && best < BOT_FRONT_RANGE,
    fireRight: Math.abs(starboard) < BOT_BROADSIDE_TOLERANCE && best < BOT_BROADSIDE_RANGE,
    fireLeft: Math.abs(port) < BOT_BROADSIDE_TOLERANCE && best < BOT_BROADSIDE_RANGE,
  })
}

/** Plays a whole match with the bot and returns its result. */
export function playWithBot(sim: Simulation, maxSteps = 20_000): MatchResult {
  for (let i = 0; i < maxSteps && !sim.result(); i++) {
    sim.step(botInput(sim.snapshot()))
    sim.drainEvents()
  }
  const result = sim.result()
  if (!result) throw new Error('match did not end')
  return result
}
