// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  apiErrorSchema,
  matchHistoryPageSchema,
  rankingPageSchema,
  submitMatchResponseSchema,
} from '../contracts/api.ts'
import { DEFAULT_MATCH_CONFIG, compareRanking, matchRecordSchema } from '../contracts/match.ts'
import { getRequestLog } from './requestLog.ts'
import { setScenario } from './scenario.ts'
import { setupMockServer } from './testing.ts'
import { call, makeSubmission } from './testUtils.ts'

setupMockServer()

const RANKING = '/api/ranking?sessionSeconds=90&spawnIntervalMs=3000'
const PLAYER = 'player-test-0001'
const HISTORY = `/api/players/${PLAYER}/matches`

describe('GET /api/ranking', () => {
  it('returns the default board: 27 entries over 3 pages, ranks over the full list', async () => {
    const seen: number[] = []
    for (const page of [1, 2, 3]) {
      const { status, body } = await call('GET', `${RANKING}&page=${page}&pageSize=10`)
      expect(status).toBe(200)
      const parsed = rankingPageSchema.parse(body)
      expect(parsed.total).toBe(27)
      expect(parsed.totalPages).toBe(3)
      expect(parsed.page).toBe(page)
      expect(parsed.items).toHaveLength(page === 3 ? 7 : 10)
      seen.push(...parsed.items.map((e) => e.rank))
    }
    expect(seen).toEqual(Array.from({ length: 27 }, (_, i) => i + 1))
  })

  it('orders by compareRanking (score desc, duration asc, playedAt asc, matchId asc)', async () => {
    const { body } = await call('GET', `${RANKING}&page=1&pageSize=50`)
    const { items } = rankingPageSchema.parse(body)
    expect(items).toHaveLength(27)
    for (let i = 1; i < items.length; i += 1) {
      expect(compareRanking(items[i - 1]!, items[i]!)).toBeLessThan(0)
    }
    // a tie on score is resolved by the shorter duration first
    const tie = items.find((e, i) => items[i + 1]?.score === e.score)
    expect(tie).toBeDefined()
  })

  it('defaults to page 1 / pageSize 10 and supports pageSize 50', async () => {
    const first = rankingPageSchema.parse((await call('GET', RANKING)).body)
    expect(first.page).toBe(1)
    expect(first.pageSize).toBe(10)
    const all = rankingPageSchema.parse((await call('GET', `${RANKING}&pageSize=50`)).body)
    expect(all.items).toHaveLength(27)
    expect(all.totalPages).toBe(1)
  })

  it('handles pagination boundaries', async () => {
    const past = rankingPageSchema.parse((await call('GET', `${RANKING}&page=4`)).body)
    expect(past.items).toEqual([])
    expect(past.total).toBe(27)
    expect(past.totalPages).toBe(3)
    const exact = rankingPageSchema.parse((await call('GET', `${RANKING}&page=3&pageSize=9`)).body)
    expect(exact.items).toHaveLength(9)
    expect(exact.totalPages).toBe(3)
    const one = rankingPageSchema.parse((await call('GET', `${RANKING}&pageSize=1&page=27`)).body)
    expect(one.items).toHaveLength(1)
    expect(one.items[0]!.rank).toBe(27)
  })

  it('only mixes matches of the same config', async () => {
    const other = rankingPageSchema.parse(
      (await call('GET', '/api/ranking?sessionSeconds=60&spawnIntervalMs=3000')).body,
    )
    expect(other.total).toBe(12)
    expect(
      other.items.every((e) => e.config.sessionSeconds === 60 && e.config.spawnIntervalMs === 3000),
    ).toBe(true)
    const unknown = rankingPageSchema.parse(
      (await call('GET', '/api/ranking?sessionSeconds=77&spawnIntervalMs=1500')).body,
    )
    expect(unknown).toMatchObject({ items: [], total: 0, totalPages: 0 })
  })

  it.each([
    ['missing config', '/api/ranking'],
    ['bad sessionSeconds', '/api/ranking?sessionSeconds=10&spawnIntervalMs=3000'],
    ['non numeric', '/api/ranking?sessionSeconds=abc&spawnIntervalMs=3000'],
    ['bad spawn step', '/api/ranking?sessionSeconds=90&spawnIntervalMs=3050'],
    ['page 0', `${RANKING}&page=0`],
    ['page too large', `${RANKING}&page=10001`],
    ['pageSize 0', `${RANKING}&pageSize=0`],
    ['pageSize 51', `${RANKING}&pageSize=51`],
    ['fractional page', `${RANKING}&page=1.5`],
    ['unknown parameter', `${RANKING}&admin=1`],
    ['repeated parameter', `${RANKING}&page=1&page=2`],
  ])('rejects %s with 400 and a contract error body', async (_label, path) => {
    const { status, body } = await call('GET', path)
    expect(status).toBe(400)
    const error = apiErrorSchema.parse(body)
    expect(error.error.code).toBe('invalid_query')
  })

  it('never echoes raw query input in error messages', async () => {
    const { body } = await call('GET', `${RANKING}&%3Cscript%3E=1`)
    expect(JSON.stringify(body)).not.toContain('script')
  })
})

describe('GET /api/players/:playerId/matches', () => {
  it('is empty for a player without confirmed matches', async () => {
    const { status, body } = await call('GET', HISTORY)
    expect(status).toBe(200)
    expect(matchHistoryPageSchema.parse(body)).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 0,
    })
  })

  it('lists confirmed matches newest first with pagination', async () => {
    for (let i = 0; i < 12; i += 1) {
      const day = String(i + 1).padStart(2, '0')
      const { status } = await call(
        'POST',
        '/api/matches',
        makeSubmission({ playerId: PLAYER, playedAt: `2026-09-${day}T10:00:00.000Z`, score: i }),
      )
      expect(status).toBe(201)
    }
    const first = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body)
    expect(first.total).toBe(12)
    expect(first.totalPages).toBe(2)
    expect(first.items).toHaveLength(10)
    expect(first.items[0]!.playedAt).toBe('2026-09-12T10:00:00.000Z')
    const dates = first.items.map((r) => r.playedAt)
    expect([...dates].sort().reverse()).toEqual(dates)
    const second = matchHistoryPageSchema.parse((await call('GET', `${HISTORY}?page=2`)).body)
    expect(second.items).toHaveLength(2)
    expect(second.items[1]!.playedAt).toBe('2026-09-01T10:00:00.000Z')
    const past = matchHistoryPageSchema.parse((await call('GET', `${HISTORY}?page=3`)).body)
    expect(past.items).toEqual([])
    expect(past.total).toBe(12)
  })

  it('only returns the requested player', async () => {
    await call('POST', '/api/matches', makeSubmission({ playerId: 'player-a-000001' }))
    await call('POST', '/api/matches', makeSubmission({ playerId: 'player-b-000001' }))
    const a = matchHistoryPageSchema.parse(
      (await call('GET', '/api/players/player-a-000001/matches')).body,
    )
    expect(a.total).toBe(1)
    expect(a.items[0]!.playerId).toBe('player-a-000001')
  })

  it.each([
    ['too short id', '/api/players/abc/matches'],
    ['id with dots', '/api/players/..%2F..%2Fetc%2Fpasswd/matches'],
    ['id too long', `/api/players/${'a'.repeat(65)}/matches`],
    ['bad page', `${HISTORY}?page=0`],
    ['bad pageSize', `${HISTORY}?pageSize=500`],
    ['unknown parameter', `${HISTORY}?sort=asc`],
  ])('rejects %s with 400', async (_label, path) => {
    const { status, body } = await call('GET', path)
    expect(status).toBe(400)
    expect(apiErrorSchema.safeParse(body).success).toBe(true)
  })
})

describe('POST /api/matches', () => {
  it('creates a record: 201 duplicate=false, then answers a repeat with 200 duplicate=true', async () => {
    const submission = makeSubmission({ score: 12 })
    const created = await call('POST', '/api/matches', submission)
    expect(created.status).toBe(201)
    const first = submitMatchResponseSchema.parse(created.body)
    expect(first.duplicate).toBe(false)
    expect(first.record).toMatchObject({ ...submission })
    expect(matchRecordSchema.safeParse(first.record).success).toBe(true)

    const again = await call('POST', '/api/matches', submission)
    expect(again.status).toBe(200)
    const second = submitMatchResponseSchema.parse(again.body)
    expect(second.duplicate).toBe(true)
    expect(second.record).toEqual(first.record) // same record, recordedAt untouched

    const ranking = rankingPageSchema.parse((await call('GET', `${RANKING}&pageSize=50`)).body)
    expect(ranking.items.filter((e) => e.matchId === submission.matchId)).toHaveLength(1)
    const history = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body)
    expect(history.items.filter((r) => r.matchId === submission.matchId)).toHaveLength(1)
  })

  it('answers 409 when the same matchId comes with a different payload', async () => {
    const submission = makeSubmission({ score: 5 })
    expect((await call('POST', '/api/matches', submission)).status).toBe(201)
    const conflict = await call('POST', '/api/matches', { ...submission, score: 6 })
    expect(conflict.status).toBe(409)
    expect(apiErrorSchema.parse(conflict.body).error.code).toBe('match_conflict')
    const history = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body)
    expect(history.items.find((r) => r.matchId === submission.matchId)?.score).toBe(5)
  })

  it('does not let a submission claim a fixture id', async () => {
    const { status, body } = await call(
      'POST',
      '/api/matches',
      makeSubmission({ matchId: 'fx-90-3000-001' }),
    )
    expect(status).toBe(409)
    expect(apiErrorSchema.parse(body).error.code).toBe('reserved_id')
  })

  it('puts a confirmed record in the ranking, consistently with history', async () => {
    const submission = makeSubmission({ score: 30 }) // 90 s at 3 s: the maximum plausible score
    await call('POST', '/api/matches', submission)
    const ranking = rankingPageSchema.parse((await call('GET', RANKING)).body)
    expect(ranking.total).toBe(28)
    expect(ranking.items[0]).toMatchObject({ rank: 1, matchId: submission.matchId, score: 30 })
    // another config is unaffected
    const other = rankingPageSchema.parse(
      (await call('GET', '/api/ranking?sessionSeconds=60&spawnIntervalMs=3000')).body,
    )
    expect(other.total).toBe(12)
  })

  const valid = makeSubmission()
  it.each([
    ['negative score', { score: -1 }],
    ['fractional score', { score: 1.5 }],
    ['implausible score', { score: 31 }],
    ['huge score', { score: 1e9 }],
    ['duration over session', { durationMs: 95_000 }],
    ['time_up too early', { durationMs: 10_000, score: 0 }],
    ['bad end reason', { endReason: 'cheat' }],
    ['bad date', { playedAt: 'yesterday' }],
    ['date with offset', { playedAt: '2026-09-29T12:00:00+03:00' }],
    ['bad matchId', { matchId: '<script>' }],
    ['hostile name', { playerName: '<img src=x onerror=alert(1)>' }],
    ['bad config', { config: { sessionSeconds: 10, spawnIntervalMs: 3000 } }],
    ['unknown key', { admin: true }],
    ['string score', { score: '10' }],
    ['negative seed', { seed: -1 }],
  ])('rejects %s with 400 and does not store it', async (_label, patch) => {
    const before = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body).total
    const { status, body } = await call('POST', '/api/matches', { ...valid, ...patch })
    expect(status).toBe(400)
    expect(apiErrorSchema.parse(body).error.code).toBe('validation_error')
    const after = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body).total
    expect(after).toBe(before)
  })

  it('rejects malformed, prototype-polluting and oversized bodies without echoing input', async () => {
    const notJson = await call('POST', '/api/matches', undefined, '{oops')
    expect(notJson.status).toBe(400)
    expect(apiErrorSchema.parse(notJson.body).error.code).toBe('invalid_json')

    const polluted = await call(
      'POST',
      '/api/matches',
      undefined,
      JSON.stringify({ ...valid }).replace('{', '{"__proto__":{"polluted":true},'),
    )
    expect(polluted.status).toBe(400)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()

    const huge = await call('POST', '/api/matches', { ...valid, playerName: 'x'.repeat(10_000) })
    expect(huge.status).toBe(413)

    const hostile = await call('POST', '/api/matches', {
      ...valid,
      playerName: '<script>alert(1)</script>',
      injected: '<script>alert(2)</script>',
    })
    expect(hostile.status).toBe(400)
    expect(JSON.stringify(hostile.body)).not.toContain('script')
    expect(JSON.stringify(hostile.body)).not.toContain('injected')

    const array = await call('POST', '/api/matches', [valid])
    expect(array.status).toBe(400)
    const nothing = await call('POST', '/api/matches', undefined, '')
    expect(nothing.status).toBe(400)
  })

  it('normalises the player name like the contract does', async () => {
    const { body } = await call(
      'POST',
      '/api/matches',
      makeSubmission({ playerName: '  Jack   Sparrow ' }),
    )
    expect(submitMatchResponseSchema.parse(body).record.playerName).toBe('Jack Sparrow')
  })
})

describe('scenarios', () => {
  it('success: healthy API', async () => {
    setScenario('success')
    expect((await call('GET', RANKING)).status).toBe(200)
    expect((await call('GET', HISTORY)).status).toBe(200)
  })

  it('empty: both lists are empty pages, submissions still work', async () => {
    setScenario('empty')
    const ranking = rankingPageSchema.parse((await call('GET', `${RANKING}&page=2`)).body)
    expect(ranking).toEqual({ items: [], page: 2, pageSize: 10, total: 0, totalPages: 0 })
    const submission = makeSubmission()
    expect((await call('POST', '/api/matches', submission)).status).toBe(201)
    const history = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body)
    expect(history.total).toBe(0)
    setScenario('success') // the confirmed record was kept
    expect(matchHistoryPageSchema.parse((await call('GET', HISTORY)).body).total).toBe(1)
  })

  it('many_pages: long ranking and a synthetic multi-page history', async () => {
    setScenario('many_pages')
    const ranking = rankingPageSchema.parse((await call('GET', `${RANKING}&page=17`)).body)
    expect(ranking.total).toBe(27 + 137)
    expect(ranking.totalPages).toBe(17)
    expect(ranking.items).toHaveLength(4)
    const history = matchHistoryPageSchema.parse((await call('GET', HISTORY)).body)
    expect(history.total).toBe(35)
    expect(history.totalPages).toBe(4)
  })

  it('http_4xx: 4xx on every endpoint', async () => {
    setScenario('http_4xx')
    for (const path of [RANKING, HISTORY]) {
      const res = await call('GET', path)
      expect(res.status).toBe(404)
      expect(apiErrorSchema.safeParse(res.body).success).toBe(true)
    }
    const post = await call('POST', '/api/matches', makeSubmission())
    expect(post.status).toBe(422)
    setScenario('success')
    expect(matchHistoryPageSchema.parse((await call('GET', HISTORY)).body).total).toBe(0)
  })

  it('http_5xx: 500 on every endpoint and nothing is stored', async () => {
    setScenario('http_5xx')
    expect((await call('GET', RANKING)).status).toBe(500)
    expect((await call('GET', HISTORY)).status).toBe(500)
    expect((await call('POST', '/api/matches', makeSubmission())).status).toBe(500)
    setScenario('success')
    expect(matchHistoryPageSchema.parse((await call('GET', HISTORY)).body).total).toBe(0)
  })

  it('ranking_fails / history_fails break only their own endpoint', async () => {
    setScenario('ranking_fails')
    expect((await call('GET', RANKING)).status).toBe(500)
    expect((await call('GET', HISTORY)).status).toBe(200)
    expect((await call('POST', '/api/matches', makeSubmission())).status).toBe(201)
    setScenario('history_fails')
    expect((await call('GET', RANKING)).status).toBe(200)
    expect((await call('GET', HISTORY)).status).toBe(500)
  })

  it('network_error: the connection fails', async () => {
    setScenario('network_error')
    await expect(call('GET', RANKING)).rejects.toThrow()
    await expect(call('POST', '/api/matches', makeSubmission())).rejects.toThrow()
  })

  it('submit_outage: POST is 503 until the scenario changes; GETs keep working', async () => {
    setScenario('submit_outage')
    const submission = makeSubmission()
    for (let i = 0; i < 3; i += 1) {
      const res = await call('POST', '/api/matches', submission)
      expect(res.status).toBe(503)
      expect(apiErrorSchema.parse(res.body).error.code).toBe('service_unavailable')
    }
    expect((await call('GET', RANKING)).status).toBe(200)
    setScenario('success')
    expect((await call('POST', '/api/matches', submission)).status).toBe(201)
    expect((await call('POST', '/api/matches', submission)).status).toBe(200)
  })

  it('logs the requests it served, with the scenario', async () => {
    setScenario('ranking_fails')
    await call('GET', RANKING)
    await call('GET', HISTORY)
    expect(getRequestLog().map((r) => [r.method, r.path, r.scenario])).toEqual([
      ['GET', '/api/ranking', 'ranking_fails'],
      ['GET', `${HISTORY}`, 'ranking_fails'],
    ])
  })

  it('serves the fixture player histories', async () => {
    const first = rankingPageSchema.parse((await call('GET', RANKING)).body).items[0]!
    const history = matchHistoryPageSchema.parse(
      (await call('GET', `/api/players/${first.playerId}/matches`)).body,
    )
    expect(history.items.length).toBeGreaterThan(0)
    expect(history.items.some((r) => r.matchId === first.matchId)).toBe(true)
    expect(DEFAULT_MATCH_CONFIG.sessionSeconds).toBe(90)
  })
})
