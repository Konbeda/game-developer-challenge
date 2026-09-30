import { describe, expect, it } from 'vitest'
import { matchSubmissionSchema } from '../contracts/match.ts'
import type { MatchResult } from '../contracts/match.ts'
import { idSchema } from '../contracts/primitives.ts'
import type { MatchSettings } from '../game/contracts.ts'
import { createId } from './ids.ts'
import { buildSubmission } from './submission.ts'

const player = { playerId: 'player-0001', playerName: 'Captain Jack' }
const settings: MatchSettings = {
  config: { sessionSeconds: 90, spawnIntervalMs: 3000 },
  seed: 123456789,
}
const timeUp: MatchResult = { score: 12, durationMs: 90_000, endReason: 'time_up' }

describe('buildSubmission', () => {
  it('builds a schema-valid submission with a fresh matchId and ISO date', () => {
    const now = new Date('2026-09-08T19:36:12.345Z')
    const built = buildSubmission({ result: timeUp, settings, player, now })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(matchSubmissionSchema.safeParse(built.submission).success).toBe(true)
    expect(idSchema.safeParse(built.submission.matchId).success).toBe(true)
    expect(built.submission).toMatchObject({
      playerId: 'player-0001',
      playerName: 'Captain Jack',
      playedAt: '2026-09-08T19:36:12.345Z',
      score: 12,
      durationMs: 90_000,
      endReason: 'time_up',
      seed: 123456789,
      config: settings.config,
    })
  })

  it('creates a different matchId for every match', () => {
    const a = buildSubmission({ result: timeUp, settings, player })
    const b = buildSubmission({ result: timeUp, settings, player })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.submission.matchId).not.toBe(b.submission.matchId)
  })

  it('uses the injected id generator', () => {
    const built = buildSubmission({ result: timeUp, settings, player, newId: () => 'match-abcdef' })
    expect(built.ok && built.submission.matchId).toBe('match-abcdef')
  })

  it('rounds fractional durations reported by the loop', () => {
    const built = buildSubmission({
      result: { score: 3, durationMs: 89_999.6, endReason: 'time_up' },
      settings,
      player,
    })
    expect(built.ok && built.submission.durationMs).toBe(90_000)
  })

  it('accepts a defeat before the time limit', () => {
    const built = buildSubmission({
      result: { score: 4, durationMs: 42_000, endReason: 'player_destroyed' },
      settings,
      player,
    })
    expect(built.ok).toBe(true)
  })

  it('rejects data the shared contract forbids instead of queueing it', () => {
    const implausible = buildSubmission({
      result: { score: 500, durationMs: 90_000, endReason: 'time_up' },
      settings,
      player,
    })
    expect(implausible.ok).toBe(false)
    const tooEarly = buildSubmission({
      result: { score: 0, durationMs: 10_000, endReason: 'time_up' },
      settings,
      player,
    })
    expect(tooEarly.ok).toBe(false)
    const badName = buildSubmission({
      result: timeUp,
      settings,
      player: { playerId: 'player-0001', playerName: '<script>' },
    })
    expect(badName.ok).toBe(false)
  })
})

describe('createId', () => {
  it('always satisfies the id contract', () => {
    for (let i = 0; i < 20; i++) expect(idSchema.safeParse(createId()).success).toBe(true)
  })
})
