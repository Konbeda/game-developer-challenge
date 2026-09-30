import { DEFAULT_GAMEPLAY } from '../../config/gameplay.ts'

/** 0 = pristine, 1 = light damage, 2 = heavy damage, 3 = critical (about to sink). */
export type DeteriorationStage = 0 | 1 | 2 | 3

/**
 * Visual damage stage of a ship from its health ratio. Stage n starts once the ratio drops to or
 * below the n-th threshold of `GameplayConfig.deterioration.thresholds` (default 75%, 50%, 25%).
 */
export function getDeteriorationStage(
  health: number,
  maxHealth: number,
  thresholds: readonly [number, number, number] = DEFAULT_GAMEPLAY.deterioration.thresholds,
): DeteriorationStage {
  if (maxHealth <= 0) return 3
  const ratio = health / maxHealth
  if (ratio > thresholds[0]) return 0
  if (ratio > thresholds[1]) return 1
  if (ratio > thresholds[2]) return 2
  return 3
}
