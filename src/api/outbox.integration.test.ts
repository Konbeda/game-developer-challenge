// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchHistoryPageSchema, rankingPageSchema } from '../contracts/api.ts'
import { pendingOutboxSchema } from '../contracts/outbox.ts'
import { STORAGE_KEYS } from '../lib/storage.ts'
import { getConfirmedRecords } from '../mocks/db.ts'
import { resetMocks } from '../mocks/index.ts'
import { getRequestLog } from '../mocks/requestLog.ts'
import { setScenario } from '../mocks/scenario.ts'
import { setupMockServer } from '../mocks/testing.ts'
import { call, makeSubmission } from '../mocks/testUtils.ts'
import { configureApi } from './client.ts'
import { postMatch } from './endpoints.ts'
import { enqueueMatch, flushPendingAndWait, getSubmissionView, retryMatch } from './outbox.ts'
import { createOutbox, type Outbox } from './outboxCore.ts'

setupMockServer()

const RANKING = '/api/ranking?sessionSeconds=90&spawnIntervalMs=3000&pageSize=50'
const PLAYER = 'player-test-0001'

const posts = () => getRequestLog().filter((r) => r.method === 'POST').length
const recordsOf = (matchId: string) => getConfirmedRecords().filter((r) => r.matchId === matchId)
const queueSize = () => {
  const raw = window.localStorage.getItem(STORAGE_KEYS.outbox)
  return raw === null ? 0 : pendingOutboxSchema.parse(JSON.parse(raw)).length
}

let created: Outbox[] = []
function makeOutbox(retryDelaysMs: readonly number[] = []): Outbox {
  const outbox = createOutbox({
    send: (submission, signal) => postMatch(submission, signal),
    retryDelaysMs,
    listenOnline: false,
  })
  created.push(outbox)
  return outbox
}

afterEach(() => {
  for (const outbox of created) outbox.destroy()
  created = []
})

async function entriesIn(matchId: string) {
  const ranking = rankingPageSchema.parse((await call('GET', RANKING)).body)
  const history = matchHistoryPageSchema.parse(
    (await call('GET', `/api/players/${PLAYER}/matches?pageSize=50`)).body,
  )
  return {
    inRanking: ranking.items.filter((e) => e.matchId === matchId).length,
    inHistory: history.items.filter((r) => r.matchId === matchId).length,
  }
}

describe('outbox against the mock API', () => {
  it('registers a finished match once: one history record and one ranking entry', async () => {
    const outbox = makeOutbox()
    const submission = makeSubmission({ playerId: PLAYER, score: 12 })
    outbox.enqueue(submission)
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'))
    expect(outbox.getSnapshot(submission.matchId)?.record).toMatchObject({
      matchId: submission.matchId,
      score: 12,
    })
    expect(await entriesIn(submission.matchId)).toEqual({ inRanking: 1, inHistory: 1 })
    expect(queueSize()).toBe(0)
  })

  it('double enqueue and repeated retry clicks produce exactly one POST and one record', async () => {
    const outbox = makeOutbox()
    const submission = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(submission)
    outbox.enqueue(submission)
    outbox.retry(submission.matchId)
    outbox.retry(submission.matchId)
    void outbox.flush()
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'))
    outbox.enqueue(submission)
    outbox.retry(submission.matchId)
    await outbox.flush()
    expect(posts()).toBe(1)
    expect(recordsOf(submission.matchId)).toHaveLength(1)
  })

  it('submit_timeout_after_commit: the retry gets duplicate=true and there is exactly ONE record', async () => {
    setScenario('submit_timeout_after_commit')
    configureApi({ timeoutMs: 120 })
    const outbox = makeOutbox()
    const submission = makeSubmission({ playerId: PLAYER, score: 8 })
    outbox.enqueue(submission)

    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('failed'), {
      timeout: 3_000,
    })
    expect(outbox.getSnapshot(submission.matchId)?.error).toMatch(/too long/i)
    // The server committed even though the client never heard back.
    expect(recordsOf(submission.matchId)).toHaveLength(1)
    expect(queueSize()).toBe(1)

    outbox.retry(submission.matchId)
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'), {
      timeout: 3_000,
    })
    expect(posts()).toBe(2)
    expect(outbox.getSnapshot(submission.matchId)?.record?.matchId).toBe(submission.matchId)
    expect(recordsOf(submission.matchId)).toHaveLength(1)
    expect(await entriesIn(submission.matchId)).toEqual({ inRanking: 1, inHistory: 1 })
    expect(queueSize()).toBe(0)
  })

  it('submit_timeout_after_commit also recovers by itself through the automatic retry', async () => {
    setScenario('submit_timeout_after_commit')
    configureApi({ timeoutMs: 120 })
    const outbox = makeOutbox([30, 30])
    const submission = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(submission)
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'), {
      timeout: 4_000,
    })
    expect(posts()).toBe(2)
    expect(recordsOf(submission.matchId)).toHaveLength(1)
  })

  it('submit_outage: stays pending across attempts, then registers ONCE after recovery', async () => {
    setScenario('submit_outage')
    const outbox = makeOutbox([25, 25, 25, 25])
    const submission = makeSubmission({ playerId: PLAYER, score: 6 })
    outbox.enqueue(submission)
    await vi.waitFor(() => expect(posts()).toBeGreaterThanOrEqual(3))
    const view = outbox.getSnapshot(submission.matchId)
    expect(['failed', 'syncing']).toContain(view?.status)
    expect(recordsOf(submission.matchId)).toHaveLength(0)
    expect(queueSize()).toBe(1)

    setScenario('success')
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'), {
      timeout: 3_000,
    })
    expect(recordsOf(submission.matchId)).toHaveLength(1)
    expect(await entriesIn(submission.matchId)).toEqual({ inRanking: 1, inHistory: 1 })
    expect(queueSize()).toBe(0)
    const total = posts()
    await outbox.flush()
    await new Promise((r) => setTimeout(r, 120)) // no stray timer sends anything more
    expect(posts()).toBe(total)
  })

  it('submit_outage: manual retry/flush keep failing with a clear message, then work after recovery', async () => {
    setScenario('submit_outage')
    const outbox = makeOutbox()
    const a = makeSubmission({ playerId: PLAYER })
    const b = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(a)
    outbox.enqueue(b)
    await vi.waitFor(() => expect(outbox.getSnapshot(b.matchId)?.status).toBe('failed'))
    expect(outbox.getSnapshot(a.matchId)?.error).toMatch(/unavailable/i)
    outbox.retry(a.matchId)
    await outbox.flush()
    expect(outbox.getSnapshot(a.matchId)?.status).toBe('failed')
    expect(recordsOf(a.matchId)).toHaveLength(0)

    setScenario('success')
    await outbox.flush()
    for (const s of [a, b]) {
      expect(outbox.getSnapshot(s.matchId)?.status).toBe('synced')
      expect(recordsOf(s.matchId)).toHaveLength(1)
    }
  })

  it('a pending match does not stop other matches from being registered', async () => {
    setScenario('submit_outage')
    const outbox = makeOutbox()
    const stuck = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(stuck)
    await vi.waitFor(() => expect(outbox.getSnapshot(stuck.matchId)?.status).toBe('failed'))
    setScenario('success')
    const next = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(next)
    await vi.waitFor(() => expect(outbox.getSnapshot(next.matchId)?.status).toBe('synced'))
    expect(outbox.getSnapshot(stuck.matchId)?.status).toBe('failed')
    await outbox.flush()
    expect(outbox.getSnapshot(stuck.matchId)?.status).toBe('synced')
    expect(recordsOf(stuck.matchId)).toHaveLength(1)
    expect(recordsOf(next.matchId)).toHaveLength(1)
  })

  it('http_4xx: failed without automatic retries; manual retry works once fixed', async () => {
    setScenario('http_4xx')
    const outbox = makeOutbox([20, 20, 20])
    const submission = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(submission)
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('failed'))
    await new Promise((r) => setTimeout(r, 150))
    expect(posts()).toBe(1)
    setScenario('success')
    outbox.retry(submission.matchId)
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'))
    expect(recordsOf(submission.matchId)).toHaveLength(1)
  })

  it('network_error is retried automatically and recovers', async () => {
    setScenario('network_error')
    const outbox = makeOutbox([25, 25, 25])
    const submission = makeSubmission({ playerId: PLAYER })
    outbox.enqueue(submission)
    await vi.waitFor(() => expect(posts()).toBeGreaterThanOrEqual(2))
    // between two automatic attempts the entry is `failed` with the user-safe message
    await vi.waitFor(() =>
      expect(outbox.getSnapshot(submission.matchId)?.error ?? '').toMatch(/connection|reach/i),
    )
    setScenario('success')
    await vi.waitFor(() => expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced'))
    expect(recordsOf(submission.matchId)).toHaveLength(1)
  })

  it('409: a matchId reused with different data is reported, never overwritten', async () => {
    const submission = makeSubmission({ playerId: PLAYER, score: 5 })
    await postMatch(submission)
    // a corrupted local copy: same id, different payload; the 409 is permanent, so no auto retry
    const clash = { ...submission, score: 6 }
    const outbox = makeOutbox([20, 20])
    outbox.enqueue(clash)
    await vi.waitFor(() => expect(outbox.getSnapshot(clash.matchId)?.status).toBe('failed'))
    expect(outbox.getSnapshot(clash.matchId)?.error).toMatch(/different data/i)
    await new Promise((r) => setTimeout(r, 100))
    expect(posts()).toBe(2) // the seeding POST + one rejected attempt
    expect(recordsOf(submission.matchId)[0]?.score).toBe(5)
  })
})

describe('app-wide outbox (module singleton)', () => {
  it('enqueueMatch / retryMatch / flushPendingAndWait drive the singleton and expose snapshots', async () => {
    setScenario('submit_outage')
    const submission = makeSubmission({ playerId: PLAYER })
    enqueueMatch(submission)
    expect(getSubmissionView(submission.matchId)?.status).toBe('pending')
    await vi.waitFor(() => expect(getSubmissionView(submission.matchId)?.status).toBe('failed'), {
      timeout: 3_000,
    })
    setScenario('success')
    retryMatch(submission.matchId)
    await vi.waitFor(() => expect(getSubmissionView(submission.matchId)?.status).toBe('synced'))
    await flushPendingAndWait()
    expect(recordsOf(submission.matchId)).toHaveLength(1)
  })

  it('refresh recovery: a fresh module instance restores the queue and flushPending registers it once', async () => {
    setScenario('submit_outage')
    const first = await import('./outbox.ts')
    const submission = makeSubmission({ playerId: PLAYER, score: 4 })
    first.enqueueMatch(submission)
    await vi.waitFor(() =>
      expect(first.getSubmissionView(submission.matchId)?.status).toBe('failed'),
    )
    expect(queueSize()).toBe(1)

    // "Reload the page": brand new module instances, same localStorage, server recovered.
    vi.resetModules()
    setScenario('success')
    const second = await import('./outbox.ts')
    expect(second).not.toBe(first)
    expect(second.getSubmissionView(submission.matchId)).toMatchObject({ status: 'failed' })
    second.flushPending()
    await vi.waitFor(() =>
      expect(second.getSubmissionView(submission.matchId)?.status).toBe('synced'),
    )
    expect(recordsOf(submission.matchId)).toHaveLength(1)
    expect(queueSize()).toBe(0)
    await second.flushPendingAndWait()
    expect(recordsOf(submission.matchId)).toHaveLength(1)
  })

  it('resetMocks clears queued submissions so nothing is re-sent afterwards', async () => {
    setScenario('submit_outage')
    const submission = makeSubmission({ playerId: PLAYER })
    enqueueMatch(submission)
    await vi.waitFor(() => expect(getSubmissionView(submission.matchId)?.status).toBe('failed'), {
      timeout: 3_000,
    })
    const before = posts()
    expect(before).toBeGreaterThan(0)
    resetMocks()
    expect(getSubmissionView(submission.matchId)).toBeNull()
    expect(queueSize()).toBe(0)
    await flushPendingAndWait()
    await new Promise((r) => setTimeout(r, 100))
    expect(posts()).toBe(0) // the request log was cleared and nothing new was sent
    expect(recordsOf(submission.matchId)).toHaveLength(0)
  })
})
