// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchHistoryPageSchema, rankingPageSchema } from '../contracts/api.ts'
import type { MatchRecord } from '../contracts/match.ts'
import { STORAGE_KEYS } from '../lib/storage.ts'
import { commitSubmission, getConfirmedRecords, resetDb } from './db.ts'
import { resetMocks } from './index.ts'
import { setupMockServer } from './testing.ts'
import { call, makeSubmission } from './testUtils.ts'

setupMockServer()

const RANKING = '/api/ranking?sessionSeconds=90&spawnIntervalMs=3000&pageSize=50'
const HISTORY = '/api/players/player-test-0001/matches'

function recordOf(overrides: Partial<MatchRecord> = {}): MatchRecord {
  const s = makeSubmission()
  return { ...s, recordedAt: '2026-09-29T12:00:05.000Z', ...overrides }
}

async function rankingTotal(): Promise<number> {
  return rankingPageSchema.parse((await call('GET', RANKING)).body).total
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mock database persistence', () => {
  it('persists confirmed records in localStorage (validated shape) and survives a reload', async () => {
    const submission = makeSubmission({ score: 7 })
    expect((await call('POST', '/api/matches', submission)).status).toBe(201)
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.mockDb)!)
    expect(stored.version).toBe(1)
    expect(stored.records).toHaveLength(1)

    vi.resetModules() // a fresh module instance has no memory of the previous one
    const fresh = await import('./db.ts')
    expect(fresh.getConfirmedRecords().map((r) => r.matchId)).toEqual([submission.matchId])
  })

  it('keeps ranking and history consistent for the same confirmed record', async () => {
    const submission = makeSubmission({ score: 9 })
    await call('POST', '/api/matches', submission)
    const ranking = rankingPageSchema.parse((await call('GET', RANKING)).body)
    const history = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body)
    const inRanking = ranking.items.find((e) => e.matchId === submission.matchId)!
    const inHistory = history.items.find((r) => r.matchId === submission.matchId)!
    expect(inRanking.score).toBe(inHistory.score)
    expect(inRanking.playedAt).toBe(inHistory.playedAt)
    expect(inRanking.durationMs).toBe(inHistory.durationMs)
  })

  it('resetMocks drops confirmed records and keeps only fixtures', async () => {
    await call('POST', '/api/matches', makeSubmission())
    expect(await rankingTotal()).toBe(28)
    resetMocks()
    expect(window.localStorage.getItem(STORAGE_KEYS.mockDb)).toBeNull()
    expect(await rankingTotal()).toBe(27)
  })
})

describe('tampered localStorage', () => {
  it.each([
    ['invalid JSON', '{not json'],
    ['a string', JSON.stringify('hello')],
    ['null', 'null'],
    ['wrong version', JSON.stringify({ version: 2, records: [] })],
    ['extra key', JSON.stringify({ version: 1, records: [], admin: true })],
    ['records not an array', JSON.stringify({ version: 1, records: {} })],
    [
      'a record with a forged score type',
      JSON.stringify({ version: 1, records: [{ ...recordOf(), score: '99' }] }),
    ],
    [
      'a record with an unknown key',
      JSON.stringify({ version: 1, records: [{ ...recordOf(), isAdmin: true }] }),
    ],
  ])('ignores %s and serves fixtures only', async (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEYS.mockDb, raw)
    expect(await rankingTotal()).toBe(27)
    expect((await call('GET', HISTORY)).status).toBe(200)
  })

  it('repairs the stored value on the next write', async () => {
    window.localStorage.setItem(STORAGE_KEYS.mockDb, '{broken')
    const submission = makeSubmission()
    expect((await call('POST', '/api/matches', submission)).status).toBe(201)
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.mockDb)!)
    expect(stored.records.map((r: MatchRecord) => r.matchId)).toEqual([submission.matchId])
    expect(await rankingTotal()).toBe(28)
  })

  it('drops duplicate ids and ids that collide with fixtures', async () => {
    const a = recordOf()
    const forged = recordOf({ matchId: 'fx-90-3000-001', score: 30 })
    window.localStorage.setItem(
      STORAGE_KEYS.mockDb,
      JSON.stringify({ version: 1, records: [a, { ...a, score: 1 }, forged] }),
    )
    expect(getConfirmedRecords().map((r) => r.matchId)).toEqual([a.matchId])
    expect(await rankingTotal()).toBe(28)
  })
})

describe('storage failures and limits', () => {
  it('keeps working from memory when localStorage refuses writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const submission = makeSubmission()
    expect((await call('POST', '/api/matches', submission)).status).toBe(201)
    expect((await call('POST', '/api/matches', submission)).status).toBe(200) // still idempotent
    expect(await rankingTotal()).toBe(28)
    vi.restoreAllMocks()
    resetDb()
    expect(await rankingTotal()).toBe(27)
  })

  it('bounds the database, keeping the newest records', () => {
    for (let i = 0; i < 505; i += 1) {
      const submission = makeSubmission({ score: 0 })
      const recordedAt = new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString()
      expect(commitSubmission(submission, recordedAt).kind).toBe('created')
    }
    const records = getConfirmedRecords()
    expect(records).toHaveLength(500)
    // the five oldest are gone
    expect(records.some((r) => r.recordedAt === '2026-09-01T00:00:00.000Z')).toBe(false)
    expect(records.some((r) => r.recordedAt === '2026-09-01T00:08:24.000Z')).toBe(true)
  })
})
