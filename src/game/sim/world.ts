import type { GameplayConfig } from '../../config/gameplay.ts'
import type { MatchResult } from '../../contracts/match.ts'
import type { EnemyKind, MatchSettings, SimEvent } from '../contracts.ts'
import type { Rng } from './rng.ts'

/** Mutable internal state of the simulation. Never leaves this module tree: snapshots are copies. */

export interface PlayerState {
  x: number
  y: number
  angle: number
  /** Current forward speed in px/s. */
  speed: number
  health: number
  maxHealth: number
  /** First step at which each weapon may fire again (integer step index). */
  frontReadyStep: number
  leftReadyStep: number
  rightReadyStep: number
}

export interface EnemyState {
  id: number
  kind: EnemyKind
  x: number
  y: number
  angle: number
  speed: number
  health: number
  maxHealth: number
  radius: number
  /** False as soon as the enemy is destroyed; the array is compacted at the end of the step. */
  alive: boolean
  /** Shooters only: first step at which the enemy may fire. */
  nextFireStep: number
}

export interface ProjectileState {
  id: number
  owner: 'player' | 'enemy'
  x: number
  y: number
  angle: number
  dirX: number
  dirY: number
  speed: number
  damage: number
  radius: number
  remainingRange: number
  alive: boolean
}

export interface SpawnerState {
  /** 1-based index of the next spawn tick; tick k fires at t = k * spawnIntervalMs. */
  nextTick: number
  /** Remaining kinds of the current shuffle bag. */
  bag: EnemyKind[]
}

export interface World {
  readonly settings: MatchSettings
  readonly gameplay: GameplayConfig
  readonly rng: Rng
  /** Total steps of the session. */
  readonly sessionSteps: number
  /** Steps simulated so far. Simulated time is `step * FIXED_STEP_MS`. */
  step: number
  score: number
  /** Shared by enemies and projectiles so ids are unique across kinds. */
  nextId: number
  player: PlayerState
  enemies: EnemyState[]
  projectiles: ProjectileState[]
  spawner: SpawnerState
  events: SimEvent[]
  result: MatchResult | null
}

/** Removes entries whose `alive` flag is false, keeping order (deterministic, no allocation). */
export function compact<T extends { alive: boolean }>(list: T[]): void {
  let write = 0
  for (let read = 0; read < list.length; read++) {
    const item = list[read] as T
    if (item.alive) list[write++] = item
  }
  list.length = write
}
