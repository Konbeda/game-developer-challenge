import type { InputState } from './contracts.ts'

/**
 * Stick steering: the player points the on-screen stick in a direction and the ship turns to that
 * heading and sails while the stick is pushed. The simulation only understands held buttons
 * (forward / turn left / turn right), so this pure function turns "where the thumb points" plus
 * "where the ship faces" into those buttons. Angles use the simulation's convention: radians, 0 is
 * east, positive is clockwise on screen (y down), which is exactly `atan2(dy, dx)` of a screen vector.
 */
export interface SteerTarget {
  /** Direction the stick points, radians. */
  angle: number
  /** How far the stick is pushed, 0 (centre) .. 1 (full). */
  magnitude: number
}

export const STEER = {
  /** Below this the stick counts as centred and the ship coasts. */
  deadZone: 0.2,
  /** From this deflection on the ship sails forward. */
  forwardFrom: 0.3,
  /** Heading error (rad) tolerated before the ship starts turning; stops the nose from twitching. */
  turnDeadband: 0.06,
  /** Beyond this heading error (rad, ~108 degrees) the ship turns in place instead of sailing on. */
  maxForwardError: 1.9,
} as const

export type SteerInput = Pick<InputState, 'forward' | 'turnLeft' | 'turnRight'>

const NONE: SteerInput = { forward: false, turnLeft: false, turnRight: false }

/** Signed smallest difference `a - b`, in (-PI, PI]. */
export function angleError(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d <= -Math.PI) d += 2 * Math.PI
  return d
}

/** Buttons to hold so a ship facing `heading` ends up facing `target`. */
export function steerToInput(target: SteerTarget | null, heading: number): SteerInput {
  if (!target || target.magnitude < STEER.deadZone) return NONE
  const error = angleError(target.angle, heading)
  return {
    // Positive error = the target lies clockwise from the bow = turn right.
    turnRight: error > STEER.turnDeadband,
    turnLeft: error < -STEER.turnDeadband,
    forward: target.magnitude >= STEER.forwardFrom && Math.abs(error) < STEER.maxForwardError,
  }
}
