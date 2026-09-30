import { FIXED_STEP_MS } from '../contracts.ts'

/** Fixed step length in seconds: every dt-based formula in the simulation uses this. */
export const DT = FIXED_STEP_MS / 1000

/** Tolerance (in steps) when converting a ms value that should land exactly on a step boundary. */
const STEP_EPSILON = 1e-6

/** Whole steps needed to cover `ms` (at least one), used for cooldowns and delays. */
export function msToSteps(ms: number): number {
  return Math.max(1, Math.ceil(ms / FIXED_STEP_MS - STEP_EPSILON))
}

/** Index of the first step whose time is >= `ms` (may be 0). */
export function firstStepAtOrAfter(ms: number): number {
  return Math.max(0, Math.ceil(ms / FIXED_STEP_MS - STEP_EPSILON))
}

export function stepsToMs(steps: number): number {
  return steps * FIXED_STEP_MS
}
