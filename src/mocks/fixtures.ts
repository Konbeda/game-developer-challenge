import { DEFAULT_PLAYER_NAME } from '../config/limits.ts'
import {
  DEFAULT_MATCH_CONFIG,
  maxPlausibleScore,
  sameConfig,
  type MatchConfig,
  type MatchRecord,
} from '../contracts/match.ts'
import { hashString, mulberry32 } from './random.ts'

/**
 * Deterministic fixtures for "the other players". Everything is derived from fixed seeds and a
 * fixed epoch, never from the clock or `Math.random`, so every run (dev, tests, demo build)
 * produces exactly the same data. Every generated record satisfies the same plausibility rules the
 * POST handler enforces (duration vs. session time, score <= floor(duration / spawn interval)).
 */

/** All fixture ids start with this prefix; submissions may not claim it (see `db.ts`). */
export const FIXTURE_ID_PREFIX = 'fx-'
export const FIXTURE_SEED = 0x50_49_52_41 // "PIRA"
/** Fixtures are dated in the 60 days before this instant. */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 7, 31, 12, 0, 0)
const DAY_MS = 86_400_000

/** Names that satisfy `PLAYER_NAME_REGEX` and the 16 character limit. */
export const FIXTURE_PLAYER_NAMES = [
  'Blackbeard',
  'Anne Bonny',
  'Calico Jack',
  'Mary Read',
  'Captain Kidd',
  'Barbarossa',
  'Grace OMalley',
  'Ching Shih',
  'Redbeard',
  'Black Bart',
  'Long John',
  'One-Eyed Willy',
  'Jolly Roger',
  'Sea Wolf',
  'Iron Hook',
  'Salty Pete',
  'Storm Rider',
  'Dread Pirate',
  'Cutlass Kate',
  'Barnacle Bill',
  'Kraken Bait',
  'Powder Monkey',
  'Rum Runner',
  'Tide Turner',
] as const

export interface FixturePlanEntry {
  config: MatchConfig
  count: number
}

/**
 * Fixtures of the standard scenarios. The default config has 27 entries (3 pages of 10, the last
 * one partial); a few other configs have smaller lists so switching options shows different boards.
 */
export const FIXTURE_PLAN: readonly FixturePlanEntry[] = [
  { config: DEFAULT_MATCH_CONFIG, count: 27 },
  { config: { sessionSeconds: 60, spawnIntervalMs: 3_000 }, count: 12 },
  { config: { sessionSeconds: 120, spawnIntervalMs: 3_000 }, count: 9 },
  { config: { sessionSeconds: 90, spawnIntervalMs: 2_000 }, count: 7 },
  { config: { sessionSeconds: 180, spawnIntervalMs: 5_000 }, count: 5 },
]

/** Extra entries per config served by the `many_pages` scenario (15 pages of 10 on top of the base). */
export const MANY_PAGES_EXTRA_COUNT = 137
/** Synthetic history length per player in the `many_pages` scenario (4 pages of 10). */
export const MANY_PAGES_HISTORY_COUNT = 35

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

interface GenerateOptions {
  config: MatchConfig
  count: number
  seed: number
  /** Id prefix, must start with `FIXTURE_ID_PREFIX`. */
  idPrefix: string
  /** Fixed player; when omitted the record picks one of `FIXTURE_PLAYER_NAMES`. */
  player?: { id: string; name: string }
}

function generateRecords(options: GenerateOptions): MatchRecord[] {
  const { config, count, seed, idPrefix, player } = options
  const rand = mulberry32(seed)
  const limitMs = config.sessionSeconds * 1000
  const records: MatchRecord[] = []
  for (let i = 0; i < count; i += 1) {
    const nameIndex = Math.floor(rand() * FIXTURE_PLAYER_NAMES.length)
    const timeUp = rand() < 0.65
    const durationMs = timeUp
      ? limitMs - Math.floor(rand() * 300)
      : Math.round((limitMs * (0.2 + 0.7 * rand())) / 10) * 10
    const max = maxPlausibleScore(config, durationMs)
    const score = Math.min(max, Math.floor(max * (0.2 + 0.75 * rand())))
    const playedAtMs = FIXTURE_EPOCH_MS - Math.floor((rand() * 60 * DAY_MS) / 1000) * 1000
    const recordedAtMs = playedAtMs + durationMs + 2_000 + Math.floor(rand() * 3) * 1_000
    records.push({
      matchId: `${idPrefix}-${pad(i + 1, 3)}`,
      playerId: player?.id ?? `${FIXTURE_ID_PREFIX}player-${pad(nameIndex + 1, 2)}`,
      playerName: player?.name ?? FIXTURE_PLAYER_NAMES[nameIndex] ?? 'Blackbeard',
      playedAt: new Date(playedAtMs).toISOString(),
      score,
      durationMs,
      endReason: timeUp ? 'time_up' : 'player_destroyed',
      config: { sessionSeconds: config.sessionSeconds, spawnIntervalMs: config.spawnIntervalMs },
      seed: Math.floor(rand() * 4_294_967_296),
      recordedAt: new Date(recordedAtMs).toISOString(),
    })
  }
  return records
}

const configTag = (config: MatchConfig): string =>
  `${config.sessionSeconds}-${config.spawnIntervalMs}`

let base: readonly MatchRecord[] | null = null

/** The standard fixtures of every config in `FIXTURE_PLAN`. Computed once, never mutated. */
export function getBaseFixtures(): readonly MatchRecord[] {
  base ??= FIXTURE_PLAN.flatMap(({ config, count }) =>
    generateRecords({
      config,
      count,
      seed: (FIXTURE_SEED ^ hashString(configTag(config))) >>> 0,
      idPrefix: `${FIXTURE_ID_PREFIX}${configTag(config)}`,
    }),
  )
  return base
}

export function getBaseFixturesForConfig(config: MatchConfig): MatchRecord[] {
  return getBaseFixtures().filter((record) => sameConfig(record.config, config))
}

const extraCache = new Map<string, readonly MatchRecord[]>()

/** `many_pages`: a long deterministic board for any requested config. */
export function getManyPagesExtra(config: MatchConfig): readonly MatchRecord[] {
  const tag = configTag(config)
  let cached = extraCache.get(tag)
  if (!cached) {
    cached = generateRecords({
      config,
      count: MANY_PAGES_EXTRA_COUNT,
      seed: (FIXTURE_SEED ^ hashString(`extra-${tag}`)) >>> 0,
      idPrefix: `${FIXTURE_ID_PREFIX}m-${tag}`,
    })
    extraCache.set(tag, cached)
  }
  return cached
}

/** `many_pages`: a synthetic past for whichever player asks, spread over the fixture configs. */
export function getManyPagesHistory(playerId: string): MatchRecord[] {
  const hash = hashString(playerId)
  const perConfig = Math.ceil(MANY_PAGES_HISTORY_COUNT / FIXTURE_PLAN.length)
  const records = FIXTURE_PLAN.flatMap(({ config }, index) =>
    generateRecords({
      config,
      count: perConfig,
      seed: (FIXTURE_SEED ^ hash ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0,
      idPrefix: `${FIXTURE_ID_PREFIX}h-${hash.toString(16).padStart(8, '0')}-${index}`,
      player: { id: playerId, name: DEFAULT_PLAYER_NAME },
    }),
  )
  return records.slice(0, MANY_PAGES_HISTORY_COUNT)
}
