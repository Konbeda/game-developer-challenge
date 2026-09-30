import { describe, expect, it } from 'vitest'
import { rankingQuerySchema } from './api.ts'
import {
  compareRanking,
  matchConfigSchema,
  matchSubmissionSchema,
  maxPlausibleScore,
  type MatchSubmission,
} from './match.ts'
import { pendingOutboxSchema } from './outbox.ts'
import { idSchema, playerNameSchema } from './primitives.ts'
import { scenarioIdSchema } from './scenarios.ts'

const valid: MatchSubmission = {
  matchId: 'match-0001-abcd',
  playerId: 'player-0001-abcd',
  playerName: 'Captain',
  playedAt: '2026-09-29T12:00:00.000Z',
  score: 10,
  durationMs: 90_000,
  endReason: 'time_up',
  config: { sessionSeconds: 90, spawnIntervalMs: 3_000 },
  seed: 42,
}

describe('playerNameSchema', () => {
  it('accepts and normalises plain names', () => {
    expect(playerNameSchema.parse('  Jack   Sparrow ')).toBe('Jack Sparrow')
    expect(playerNameSchema.parse('a_b-c9')).toBe('a_b-c9')
  })

  it.each([
    '',
    '   ',
    'a'.repeat(17),
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    'name\u0000',
    'na\nme',
    'javascript:alert(1)',
    '__proto__;',
    'drop table;--',
    'zero​width',
    'ｆｕｌｌｗｉｄｔｈ',
    'émile',
  ])('rejects hostile or unsupported name %j', (name) => {
    expect(playerNameSchema.safeParse(name).success).toBe(false)
  })

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 42, {}, [], ['a']]) {
      expect(playerNameSchema.safeParse(v).success).toBe(false)
    }
  })
})

describe('idSchema', () => {
  it('accepts safe ids and rejects others', () => {
    expect(idSchema.safeParse('abcdefgh').success).toBe(true)
    expect(idSchema.safeParse('short').success).toBe(false)
    expect(idSchema.safeParse('a'.repeat(65)).success).toBe(false)
    expect(idSchema.safeParse('../../etc/passwd').success).toBe(false)
    expect(idSchema.safeParse('id with space').success).toBe(false)
    expect(idSchema.safeParse('<b>bold</b>x').success).toBe(false)
  })
})

describe('matchConfigSchema', () => {
  it('enforces documented limits', () => {
    expect(matchConfigSchema.safeParse({ sessionSeconds: 60, spawnIntervalMs: 500 }).success).toBe(
      true,
    )
    expect(
      matchConfigSchema.safeParse({ sessionSeconds: 180, spawnIntervalMs: 10_000 }).success,
    ).toBe(true)
    for (const config of [
      { sessionSeconds: 59, spawnIntervalMs: 3000 },
      { sessionSeconds: 181, spawnIntervalMs: 3000 },
      { sessionSeconds: 90.5, spawnIntervalMs: 3000 },
      { sessionSeconds: 90, spawnIntervalMs: 0 },
      { sessionSeconds: 90, spawnIntervalMs: -100 },
      { sessionSeconds: 90, spawnIntervalMs: 499 },
      { sessionSeconds: 90, spawnIntervalMs: 10_100 },
      { sessionSeconds: 90, spawnIntervalMs: 3_050 },
      { sessionSeconds: Number.NaN, spawnIntervalMs: 3000 },
      { sessionSeconds: Infinity, spawnIntervalMs: 3000 },
      { sessionSeconds: '90', spawnIntervalMs: 3000 },
      { sessionSeconds: 90, spawnIntervalMs: 3000, extra: true },
    ]) {
      expect(matchConfigSchema.safeParse(config).success, JSON.stringify(config)).toBe(false)
    }
  })
})

describe('matchSubmissionSchema', () => {
  it('accepts a legitimate submission', () => {
    expect(matchSubmissionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects unknown keys, including prototype pollution attempts', () => {
    expect(matchSubmissionSchema.safeParse({ ...valid, admin: true }).success).toBe(false)
    // JSON.parse creates a real own "__proto__" key, which strict objects must reject.
    const polluted = JSON.parse(
      JSON.stringify({ ...valid }).replace('{', '{"__proto__":{"polluted":true},'),
    )
    expect(matchSubmissionSchema.safeParse(polluted).success).toBe(false)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(
      matchSubmissionSchema.safeParse(JSON.parse('{"constructor":{"prototype":{"a":1}}}')).success,
    ).toBe(false)
  })

  it.each([
    ['negative score', { score: -1 }],
    ['fractional score', { score: 1.5 }],
    ['huge score', { score: 1e9 }],
    ['implausible score', { score: 31 }],
    ['NaN score', { score: Number.NaN }],
    ['string score', { score: '10' as unknown as number }],
    ['duration over session', { durationMs: 95_000 }],
    ['time_up too early', { durationMs: 10_000, score: 0 }],
    ['bad end reason', { endReason: 'cheat' as unknown as 'time_up' }],
    ['bad date', { playedAt: 'yesterday' }],
    ['date with offset injection', { playedAt: '2026-09-29T12:00:00+03:00' }],
    ['negative seed', { seed: -1 }],
    ['seed above uint32', { seed: 2 ** 32 }],
    ['bad matchId', { matchId: '<script>' }],
    ['hostile name', { playerName: '<img onerror=x>' }],
  ])('rejects %s', (_label, patch) => {
    expect(matchSubmissionSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it('accepts a player_destroyed match that ended early', () => {
    const early = { ...valid, endReason: 'player_destroyed' as const, durationMs: 20_000, score: 3 }
    expect(matchSubmissionSchema.safeParse(early).success).toBe(true)
  })

  it('caps the plausible score by spawn interval', () => {
    expect(maxPlausibleScore(valid.config, 90_000)).toBe(30)
  })
})

describe('compareRanking', () => {
  const base = { score: 5, durationMs: 60_000, playedAt: '2026-09-29T10:00:00.000Z', matchId: 'b' }
  it('orders by score desc, duration asc, playedAt asc, matchId asc', () => {
    const list = [
      { ...base, matchId: 'e', score: 4 },
      { ...base, matchId: 'd' },
      { ...base, matchId: 'c', playedAt: '2026-09-29T09:00:00.000Z' },
      { ...base, matchId: 'b', durationMs: 50_000 },
      { ...base, matchId: 'a', score: 9 },
    ].sort(compareRanking)
    expect(list.map((e) => e.matchId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('is deterministic for equal keys except id', () => {
    const a = { ...base, matchId: 'a' }
    const b = { ...base, matchId: 'b' }
    expect(compareRanking(a, b)).toBeLessThan(0)
    expect(compareRanking(b, a)).toBeGreaterThan(0)
    expect(compareRanking(a, a)).toBe(0)
  })
})

describe('query and storage schemas', () => {
  it('coerces and bounds ranking query strings', () => {
    const ok = rankingQuerySchema.safeParse({ sessionSeconds: '90', spawnIntervalMs: '3000' })
    expect(ok.success && ok.data.page).toBe(1)
    expect(
      rankingQuerySchema.safeParse({ sessionSeconds: '90', spawnIntervalMs: '3000', page: '0' })
        .success,
    ).toBe(false)
    expect(
      rankingQuerySchema.safeParse({
        sessionSeconds: '90',
        spawnIntervalMs: '3000',
        pageSize: '9999',
      }).success,
    ).toBe(false)
    expect(
      rankingQuerySchema.safeParse({ sessionSeconds: 'abc', spawnIntervalMs: '3000' }).success,
    ).toBe(false)
  })

  it('rejects tampered outbox data', () => {
    expect(
      pendingOutboxSchema.safeParse([
        { submission: { ...valid, score: 9999 }, attempts: 0, lastError: null },
      ]).success,
    ).toBe(false)
    expect(
      pendingOutboxSchema.safeParse([{ submission: valid, attempts: 0, lastError: null }]).success,
    ).toBe(true)
    expect(pendingOutboxSchema.safeParse('not-an-array').success).toBe(false)
  })

  it('allowlists scenario ids', () => {
    expect(scenarioIdSchema.safeParse('success').success).toBe(true)
    expect(scenarioIdSchema.safeParse('../evil').success).toBe(false)
  })
})
