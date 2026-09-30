import type { MatchConfig, MatchResult } from '../contracts/match.ts'
import type { SteerTarget } from './steering.ts'

export type { SteerTarget }

/** Logical arena size in world units. The renderer scales it to the screen; the simulation never sees pixels. */
export const ARENA = { width: 1600, height: 900 } as const

/** Simulation step. The loop accumulates real time and runs whole fixed steps. */
export const FIXED_STEP_MS = 1000 / 60

/** Held controls. Cooldowns and edge handling live in the simulation, not in the input layer. */
export interface InputState {
  forward: boolean
  turnLeft: boolean
  turnRight: boolean
  fireFront: boolean
  fireLeft: boolean
  fireRight: boolean
}

export const EMPTY_INPUT: Readonly<InputState> = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
}

export interface MatchSettings {
  /** Snapshot of the options when the match started. */
  config: MatchConfig
  /** Drives every random choice in the simulation (spawn positions, enemy types...). */
  seed: number
}

export type MatchPhase = 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'ended'

/** Everything the React UI is allowed to know about a running match. Emitted on change only, never per frame. */
export interface HudState {
  phase: MatchPhase
  score: number
  timeRemainingMs: number
  playerHealth: number
  playerMaxHealth: number
}

export const INITIAL_HUD: Readonly<HudState> = {
  phase: 'idle',
  score: 0,
  timeRemainingMs: 0,
  playerHealth: 0,
  playerMaxHealth: 0,
}

export type EnemyKind = 'chaser' | 'shooter'

/** Plain-data view of the world, used by the renderer and by the E2E test hook. */
export interface SimSnapshot {
  timeMs: number
  phase: MatchPhase
  score: number
  arena: { width: number; height: number }
  player: { x: number; y: number; angle: number; health: number; maxHealth: number }
  enemies: {
    id: number
    kind: EnemyKind
    x: number
    y: number
    angle: number
    health: number
    maxHealth: number
  }[]
  projectiles: { id: number; owner: 'player' | 'enemy'; x: number; y: number; angle: number }[]
  islands: { x: number; y: number; radius: number }[]
}

/** One-shot facts for the renderer/audio (effects, sounds). Additive: new variants may be added. */
export type SimEvent =
  | { type: 'shot'; owner: 'player' | 'enemy'; x: number; y: number; angle: number }
  | { type: 'hit'; target: 'player' | 'enemy' | 'island'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; big: boolean }
  | { type: 'enemy_destroyed'; kind: EnemyKind; x: number; y: number; byPlayer: boolean }
  | { type: 'player_damaged'; health: number }
  | { type: 'match_end'; result: MatchResult }

/** Pure game rules. No Pixi, no DOM, no wall clock, no Math.random. */
export interface Simulation {
  /** Advances exactly one fixed step (FIXED_STEP_MS) with the given held input. No-op after the match ended. */
  step(input: Readonly<InputState>): void
  snapshot(): SimSnapshot
  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[]
  /** Non-null once the match ended. */
  result(): MatchResult | null
}

/** Imperative surface the React shell uses to drive the Pixi game. Implemented in src/game/host. */
export interface GameHost {
  /** Creates the canvas inside `container` and loads textures. Rejects if assets fail; safe to call again to retry. */
  mount(container: HTMLElement, onProgress?: (ratio: number) => void): Promise<void>
  start(settings: MatchSettings): void
  pause(): void
  /** Resumes only after an explicit player action; discards input held during the pause. */
  resume(): void
  restart(): void
  setInput(partial: Partial<InputState>): void
  /**
   * Stick steering (touch): the ship turns towards `target.angle` and sails while the stick is pushed.
   * `null` releases it. It adds to `setInput` (keys and buttons still work) and is dropped on pause.
   */
  setSteer(target: SteerTarget | null): void
  subscribe(listener: (hud: HudState) => void): () => void
  onEnd(listener: (result: MatchResult, settings: MatchSettings) => void): () => void
  /** Releases ticker, listeners, textures, entities and the canvas. Idempotent (React Strict Mode). */
  destroy(): void
}

/** E2E instrumentation (window.__game). Present only when VITE_E2E === 'true'. Observes state and drives the clock; rules still run for real. */
export interface GameTestHook {
  getSnapshot(): SimSnapshot | null
  getHud(): HudState
  /** Switch between the real requestAnimationFrame clock and a manual one. */
  setClockMode(mode: 'realtime' | 'manual'): void
  /** Manual clock only: runs whole fixed steps covering `ms`. */
  advance(ms: number): void
  /** Overrides the seed of the next match. */
  setSeed(seed: number): void
}

declare global {
  interface Window {
    __game?: GameTestHook
  }
}
