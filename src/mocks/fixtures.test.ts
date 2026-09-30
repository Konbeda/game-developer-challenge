import { describe, expect, it } from 'vitest'
import { compareRanking, matchRecordSchema, matchSubmissionSchema } from '../contracts/match.ts'
import { DEFAULT_MATCH_CONFIG, sameConfig } from '../contracts/match.ts'
import {
  FIXTURE_ID_PREFIX,
  FIXTURE_PLAN,
  FIXTURE_PLAYER_NAMES,
  MANY_PAGES_EXTRA_COUNT,
  MANY_PAGES_HISTORY_COUNT,
  getBaseFixtures,
  getBaseFixturesForConfig,
  getManyPagesExtra,
  getManyPagesHistory,
} from './fixtures.ts'
import { hashString, mulberry32 } from './random.ts'

describe('random helpers', () => {
  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const first = Array.from({ length: 50 }, () => a())
    expect(first).toEqual(Array.from({ length: 50 }, () => b()))
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true)
    expect(mulberry32(43)()).not.toBe(first[0])
  })

  it('hashString is stable', () => {
    expect(hashString('pirate')).toBe(hashString('pirate'))
    expect(hashString('pirate')).not.toBe(hashString('pirates'))
  })
})

describe('fixtures', () => {
  it('are reproducible between runs', () => {
    const snapshot = JSON.stringify(getBaseFixtures())
    // Recomputing from scratch would yield the same list; the cache must never be mutated.
    expect(JSON.stringify(getBaseFixtures())).toBe(snapshot)
    expect(getBaseFixtures()[0]).toEqual({
      matchId: 'fx-90-3000-001',
      playerId: expect.stringMatching(/^fx-player-\d\d$/),
      playerName: expect.any(String),
      playedAt: expect.stringMatching(/^2026-0[78]-/),
      score: expect.any(Number),
      durationMs: expect.any(Number),
      endReason: expect.stringMatching(/time_up|player_destroyed/),
      config: DEFAULT_MATCH_CONFIG,
      seed: expect.any(Number),
      recordedAt: expect.any(String),
    })
  })

  it('give the default config at least 27 entries (3 pages of 10)', () => {
    expect(getBaseFixturesForConfig(DEFAULT_MATCH_CONFIG).length).toBeGreaterThanOrEqual(27)
    expect(FIXTURE_PLAN.length).toBeGreaterThan(1)
    for (const { config, count } of FIXTURE_PLAN) {
      expect(getBaseFixturesForConfig(config)).toHaveLength(count)
    }
  })

  it('are valid records with unique ids, reserved prefix and allowlisted names', () => {
    const all = [
      ...getBaseFixtures(),
      ...getManyPagesExtra(DEFAULT_MATCH_CONFIG),
      ...getManyPagesHistory('player-abcdef12'),
    ]
    const ids = new Set<string>()
    for (const record of all) {
      expect(matchRecordSchema.safeParse(record).success, record.matchId).toBe(true)
      expect(record.matchId.startsWith(FIXTURE_ID_PREFIX)).toBe(true)
      ids.add(record.matchId)
    }
    expect(ids.size).toBe(all.length)
    for (const name of FIXTURE_PLAYER_NAMES) {
      expect(name.length).toBeLessThanOrEqual(16)
    }
  })

  it('obey the same plausibility rules as the POST handler', () => {
    const all = [
      ...getBaseFixtures(),
      ...FIXTURE_PLAN.flatMap(({ config }) => getManyPagesExtra(config)),
      ...getManyPagesHistory('player-abcdef12'),
    ]
    for (const record of all) {
      const submission = {
        matchId: record.matchId,
        playerId: record.playerId,
        playerName: record.playerName,
        playedAt: record.playedAt,
        score: record.score,
        durationMs: record.durationMs,
        endReason: record.endReason,
        config: record.config,
        seed: record.seed,
      }
      expect(matchSubmissionSchema.safeParse(submission).success, record.matchId).toBe(true)
    }
  })

  it('contain score ties, so the tie-break rules matter', () => {
    const board = getBaseFixturesForConfig(DEFAULT_MATCH_CONFIG)
    const scores = board.map((r) => r.score)
    expect(new Set(scores).size).toBeLessThan(scores.length)
    const sorted = [...board].sort(compareRanking)
    for (let i = 1; i < sorted.length; i += 1) {
      expect(compareRanking(sorted[i - 1]!, sorted[i]!)).toBeLessThan(0)
    }
  })

  it('many_pages helpers generate long deterministic lists', () => {
    const extra = getManyPagesExtra(DEFAULT_MATCH_CONFIG)
    expect(extra).toHaveLength(MANY_PAGES_EXTRA_COUNT)
    expect(getManyPagesExtra({ sessionSeconds: 77, spawnIntervalMs: 1_500 })).toHaveLength(
      MANY_PAGES_EXTRA_COUNT,
    )
    expect(extra.every((r) => sameConfig(r.config, DEFAULT_MATCH_CONFIG))).toBe(true)
    const history = getManyPagesHistory('player-abcdef12')
    expect(history).toHaveLength(MANY_PAGES_HISTORY_COUNT)
    expect(history.every((r) => r.playerId === 'player-abcdef12')).toBe(true)
    expect(getManyPagesHistory('player-abcdef12')).toEqual(history)
    expect(getManyPagesHistory('player-other-99')[0]!.matchId).not.toBe(history[0]!.matchId)
  })
})
