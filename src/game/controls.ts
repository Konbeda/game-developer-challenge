import type { InputState } from './contracts.ts'
import type { SteerTarget } from './steering.ts'

/**
 * Keyboard bindings by `KeyboardEvent.code`. Single source of truth: the input layer captures
 * these keys and the UI renders the same list as instructions.
 *
 * Movement is direction based, like the touch stick: W/A/S/D choose the screen direction the ship
 * sails towards (up, left, down, right) and the ship turns to it by itself; there is no
 * tank-style "forward + rotate". Weapons are on the arrow keys, one hand each.
 */
export const MOVE_BINDINGS = {
  up: ['KeyW'],
  left: ['KeyA'],
  down: ['KeyS'],
  right: ['KeyD'],
} as const

export type MoveDirection = keyof typeof MOVE_BINDINGS

export const FIRE_BINDINGS: Record<
  Extract<keyof InputState, 'fireFront' | 'fireLeft' | 'fireRight'>,
  readonly string[]
> = {
  fireFront: ['ArrowUp'],
  fireLeft: ['ArrowLeft'],
  fireRight: ['ArrowRight'],
}

export const PAUSE_KEYS: readonly string[] = ['KeyP', 'Escape']

const MOVE_DIRECTIONS = Object.keys(MOVE_BINDINGS) as MoveDirection[]

/** Every key code the match captures for movement. */
export const MOVE_CODES: readonly string[] = MOVE_DIRECTIONS.flatMap((d) => MOVE_BINDINGS[d])

function isDown(held: ReadonlySet<string>, direction: MoveDirection): boolean {
  return MOVE_BINDINGS[direction].some((code) => held.has(code))
}

/**
 * The stick-style steering the held movement keys ask for: W+D is north-east, W alone is north, and
 * opposite keys cancel out (A+D, W+S). Angles use the simulation's convention (0 = east, clockwise
 * positive, y down), so "up" is -PI/2. Keys always mean a full push.
 */
export function steerFromKeys(held: ReadonlySet<string>): SteerTarget | null {
  const dx = Number(isDown(held, 'right')) - Number(isDown(held, 'left'))
  const dy = Number(isDown(held, 'down')) - Number(isDown(held, 'up'))
  if (dx === 0 && dy === 0) return null
  return { angle: Math.atan2(dy, dx), magnitude: 1 }
}

/** Human-readable instruction rows for menus and the pause dialog. */
export const CONTROL_HELP: readonly { action: string; keys: string; touch: string }[] = [
  { action: 'Steer and sail', keys: 'W / A / S / D', touch: 'Point the stick' },
  { action: 'Fire front cannon', keys: 'Up', touch: 'Crosshair button' },
  { action: 'Fire left broadside (3 shots)', keys: 'Left', touch: 'Left flame button' },
  { action: 'Fire right broadside (3 shots)', keys: 'Right', touch: 'Right flame button' },
  { action: 'Pause', keys: 'P / Esc', touch: 'Pause button' },
]
