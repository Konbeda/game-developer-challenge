/** Hard limits for every player-controllable value. Single source of truth for UI, MSW and tests. */
export const LIMITS = {
  sessionSeconds: { min: 60, max: 180, default: 90 },
  spawnIntervalMs: { min: 500, max: 10_000, step: 100, default: 3_000 },
  playerName: { min: 1, max: 16 },
  /** Extra time (ms) tolerated between reported duration and configured session, for tick granularity. */
  durationToleranceMs: 1_000,
  /** Page sizes accepted by the list endpoints. */
  pageSize: { min: 1, max: 50, default: 10 },
  maxPage: 10_000,
} as const

export const DEFAULT_PLAYER_NAME = 'Captain'
