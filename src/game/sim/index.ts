/**
 * Pirate Battle simulation core: pure game rules, no Pixi, DOM, wall clock or Math.random.
 *
 * Coordinates: world units of the ARENA rectangle (1600x900), origin at the top-left corner,
 * x grows to the right (east) and y grows DOWN (south).
 * Angles are radians. 0 points east (+x). Positive rotation is CLOCKWISE on screen because y is
 * down, so pi/2 points south, pi points west and -pi/2 points north. A ship at angle `a` has its
 * bow along (cos a, sin a), its starboard (right) side along (cos(a + pi/2), sin(a + pi/2)) and
 * its port (left) side along (cos(a - pi/2), sin(a - pi/2)).
 *
 * Time: `step(input)` always advances exactly FIXED_STEP_MS. Simulated time is `steps *
 * FIXED_STEP_MS`, cooldowns and spawn ticks are converted to whole steps, so results do not depend
 * on the frame rate of the host. The same seed and the same input sequence always yield identical
 * snapshots (all randomness comes from a seeded mulberry32 generator).
 *
 * Step order: player -> enemies -> projectiles (swept collisions) -> chaser impacts -> end check
 * -> weapon fire -> spawn tick. Once the match ended `step` is a no-op.
 *
 * End rules: the match ends when the player's health reaches 0 (`player_destroyed`) or when the
 * session time is up (`time_up`). If both happen in the same step, `player_destroyed` wins.
 * Only enemies destroyed by player projectiles score; a Chaser exploding on the ship never does.
 * Enemy spawn ticks are at t = k * spawnIntervalMs for k >= 1 (never at t = 0), one enemy per tick,
 * so score <= floor(durationMs / spawnIntervalMs) always holds.
 */
export { createDebugSimulation, createSimulation } from './simulation.ts'
export type { DebugSimulation } from './simulation.ts'
export { getEnemyMaxHealth } from './combat.ts'
export { getDeteriorationStage } from './deterioration.ts'
export type { DeteriorationStage } from './deterioration.ts'
export { createRng } from './rng.ts'
export type { Rng } from './rng.ts'
export {
  angleDelta,
  isClearOfIslands,
  normalizeAngle,
  segmentCircleHit,
  segmentHitsIsland,
} from './geometry.ts'
