// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmitMatchResponse } from '../contracts/api.ts'
import type { MatchSubmission } from '../contracts/match.ts'
import { pendingOutboxSchema } from '../contracts/outbox.ts'
import { STORAGE_KEYS } from '../lib/storage.ts'
import { makeSubmission } from '../mocks/testUtils.ts'
import { ApiError } from './errors.ts'
import {
  RETRY_DELAYS_MS,
  SYNCED_STORAGE_KEY,
  createOutbox,
  type Outbox,
  type OutboxDeps,
} from './outboxCore.ts'

type SendFn = OutboxDeps['send']

function ok(submission: MatchSubmission, duplicate = false): SubmitMatchResponse {
  return { record: { ...submission, recordedAt: '2026-09-29T12:00:05.000Z' }, duplicate }
}

const timeoutError = () => new ApiError({ kind: 'timeout', message: 'The server took too long.' })
const outage = () => new ApiError({ kind: 'http', status: 503, message: 'Service unavailable.' })
const rejected = () => new ApiError({ kind: 'http', status: 400, message: 'Score is invalid.' })

function queued(): unknown {
  const raw = window.localStorage.getItem(STORAGE_KEYS.outbox)
  return raw === null ? null : JSON.parse(raw)
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

let outboxes: Outbox[] = []
function make(send: SendFn, extra: Partial<OutboxDeps> = {}): Outbox {
  const outbox = createOutbox({ send, ...extra })
  outboxes.push(outbox)
  return outbox
}

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
})

afterEach(() => {
  for (const outbox of outboxes) outbox.destroy()
  outboxes = []
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('persistence and lifecycle', () => {
  it('persists the entry BEFORE the first request', async () => {
    const submission = makeSubmission()
    let seenAtSend: unknown = 'not called'
    const send = vi.fn<SendFn>(async (s) => {
      seenAtSend = queued()
      return ok(s)
    })
    const outbox = make(send)
    outbox.enqueue(submission)
    // synchronously durable, request not started yet
    expect(send).not.toHaveBeenCalled()
    expect(pendingOutboxSchema.parse(queued())).toEqual([
      { submission, attempts: 0, lastError: null },
    ])
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect(pendingOutboxSchema.parse(seenAtSend)[0]?.submission.matchId).toBe(submission.matchId)
  })

  it('walks pending -> syncing -> synced and clears the persisted queue', async () => {
    const submission = makeSubmission()
    let resolve!: (r: SubmitMatchResponse) => void
    const send = vi.fn<SendFn>(() => new Promise((r) => (resolve = r)))
    const onSynced = vi.fn()
    const outbox = make(send, { onSynced })
    const seen: string[] = []
    outbox.subscribe(() => seen.push(outbox.getSnapshot(submission.matchId)!.status))

    outbox.enqueue(submission)
    expect(outbox.getSnapshot(submission.matchId)).toEqual({
      status: 'pending',
      record: null,
      error: null,
    })
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('syncing')
    resolve(ok(submission))
    await tick()

    const view = outbox.getSnapshot(submission.matchId)!
    expect(view.status).toBe('synced')
    expect(view.record?.matchId).toBe(submission.matchId)
    expect(view.error).toBeNull()
    expect(seen).toEqual(['pending', 'syncing', 'synced'])
    expect(queued()).toBeNull()
    expect(onSynced).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('treats a duplicate answer (200, duplicate: true) as success', async () => {
    const submission = makeSubmission()
    const outbox = make(async (s) => ok(s, true))
    outbox.enqueue(submission)
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('never throws and returns nothing to the caller', () => {
    const outbox = make(async (s) => ok(s))
    expect(outbox.enqueue(makeSubmission())).toBeUndefined()
    expect(outbox.retry('does-not-exist')).toBeUndefined()
    expect(() => outbox.enqueue(null as never)).not.toThrow()
    expect(() => outbox.enqueue(undefined as never)).not.toThrow()
    expect(() => outbox.enqueue('nope' as never)).not.toThrow()
  })

  it('reports an invalid submission as failed without sending or persisting it', async () => {
    const send = vi.fn<SendFn>(async (s) => ok(s))
    const outbox = make(send)
    const bad = makeSubmission({ score: 9_999 })
    outbox.enqueue(bad)
    await tick(60_000)
    expect(send).not.toHaveBeenCalled()
    expect(queued()).toBeNull()
    const view = outbox.getSnapshot(bad.matchId)!
    expect(view.status).toBe('failed')
    expect(view.error).toMatch(/invalid/i)
    outbox.retry(bad.matchId)
    await tick()
    expect(send).not.toHaveBeenCalled()
  })

  it('unknown or null ids have no snapshot', () => {
    const outbox = make(async (s) => ok(s))
    expect(outbox.getSnapshot(null)).toBeNull()
    expect(outbox.getSnapshot('nope-nope-nope')).toBeNull()
  })

  it('snapshots are referentially stable until that match changes', async () => {
    const a = makeSubmission()
    const b = makeSubmission()
    const outbox = make(async (s) => ok(s))
    outbox.enqueue(a)
    const before = outbox.getSnapshot(a.matchId)
    expect(outbox.getSnapshot(a.matchId)).toBe(before)
    outbox.enqueue(b)
    expect(outbox.getSnapshot(a.matchId)).toBe(before)
    await tick()
    expect(outbox.getSnapshot(a.matchId)).not.toBe(before)
    const synced = outbox.getSnapshot(a.matchId)
    outbox.enqueue(a) // repeated enqueue of a synced match changes nothing
    outbox.retry(a.matchId)
    await tick()
    expect(outbox.getSnapshot(a.matchId)).toBe(synced)
  })

  it('unsubscribed listeners are not called and a faulty listener does not break others', async () => {
    const submission = makeSubmission()
    const outbox = make(async (s) => ok(s))
    const good = vi.fn()
    const unsubscribed = vi.fn()
    outbox.subscribe(() => {
      throw new Error('boom')
    })
    outbox.subscribe(good)
    outbox.subscribe(unsubscribed)()
    outbox.enqueue(submission)
    await tick()
    expect(good).toHaveBeenCalled()
    expect(unsubscribed).not.toHaveBeenCalled()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('still sends when localStorage refuses writes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const submission = makeSubmission()
    const send = vi.fn<SendFn>(async (s) => ok(s))
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })
})

describe('idempotency and single flight', () => {
  it('enqueueing the same match twice (or many times) sends once and keeps one entry', async () => {
    const submission = makeSubmission()
    let resolve!: (r: SubmitMatchResponse) => void
    const send = vi.fn<SendFn>(() => new Promise((r) => (resolve = r)))
    const outbox = make(send)
    outbox.enqueue(submission)
    outbox.enqueue(submission)
    outbox.enqueue({ ...submission })
    await tick()
    outbox.enqueue(submission)
    outbox.retry(submission.matchId)
    outbox.retry(submission.matchId)
    void outbox.flush()
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect(pendingOutboxSchema.parse(queued())).toHaveLength(1)
    resolve(ok(submission))
    await tick()
    outbox.enqueue(submission)
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('every attempt carries the same matchId and payload', async () => {
    const submission = makeSubmission()
    const send = vi
      .fn<SendFn>()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockImplementation(async (s) => ok(s, true))
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick(0)
    await tick(RETRY_DELAYS_MS[0])
    await tick(RETRY_DELAYS_MS[1])
    expect(send).toHaveBeenCalledTimes(3)
    for (const [sent] of send.mock.calls) expect(sent).toEqual(submission)
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('a second enqueue with the same matchId but other data does not replace the queued entry', async () => {
    const submission = makeSubmission({ score: 3 })
    const send = vi.fn<SendFn>(async (s) => ok(s))
    const outbox = make(send)
    outbox.enqueue(submission)
    outbox.enqueue({ ...submission, score: 4 })
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0].score).toBe(3)
  })

  it('handles many entries independently; one failing does not block the others', async () => {
    const subs = Array.from({ length: 6 }, () => makeSubmission())
    const send = vi.fn<SendFn>(async (s) => {
      if (s.matchId === subs[2]!.matchId) throw outage()
      return ok(s)
    })
    const outbox = make(send)
    for (const s of subs) outbox.enqueue(s)
    await tick()
    expect(subs.map((s) => outbox.getSnapshot(s.matchId)?.status)).toEqual([
      'synced',
      'synced',
      'failed',
      'synced',
      'synced',
      'synced',
    ])
    expect(pendingOutboxSchema.parse(queued())).toHaveLength(1)
  })
})

describe('failures and retries', () => {
  it('backs off 2s, 5s, 15s, 30s and then waits for a manual trigger', async () => {
    expect(RETRY_DELAYS_MS).toEqual([2_000, 5_000, 15_000, 30_000])
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(timeoutError())
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    expect(outbox.getSnapshot(submission.matchId)).toMatchObject({
      status: 'failed',
      error: 'The server took too long.',
    })
    await tick(1_999)
    expect(send).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(send).toHaveBeenCalledTimes(2)
    await tick(4_999)
    expect(send).toHaveBeenCalledTimes(2)
    await tick(1)
    expect(send).toHaveBeenCalledTimes(3)
    await tick(15_000)
    expect(send).toHaveBeenCalledTimes(4)
    await tick(30_000)
    expect(send).toHaveBeenCalledTimes(5)
    // exhausted: nothing else is scheduled
    expect(vi.getTimerCount()).toBe(0)
    await tick(10 * 60_000)
    expect(send).toHaveBeenCalledTimes(5)
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('failed')
    // the entry is still persisted with its error and attempt count
    expect(pendingOutboxSchema.parse(queued())).toEqual([
      { submission, attempts: 5, lastError: 'The server took too long.' },
    ])
  })

  it('manual retry after exhaustion works and restarts the backoff', async () => {
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(outage())
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick(2_000 + 5_000 + 15_000 + 30_000)
    expect(send).toHaveBeenCalledTimes(5)
    send.mockImplementation(async (s) => ok(s))
    outbox.retry(submission.matchId)
    await tick()
    expect(send).toHaveBeenCalledTimes(6)
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('manual retry cancels the scheduled automatic retry (no double send)', async () => {
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValueOnce(outage())
    send.mockImplementation(async (s) => ok(s))
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('failed')
    outbox.retry(submission.matchId)
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
    await tick(60_000)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not retry validation (4xx) errors automatically, but a manual retry works', async () => {
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(rejected())
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick(10 * 60_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(outbox.getSnapshot(submission.matchId)).toMatchObject({
      status: 'failed',
      error: 'Score is invalid.',
    })
    expect(vi.getTimerCount()).toBe(0)
    send.mockImplementation(async (s) => ok(s))
    outbox.retry(submission.matchId)
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('409 conflict: failed with a clear message, no automatic retry', async () => {
    const submission = makeSubmission()
    const conflict = new ApiError({
      kind: 'http',
      status: 409,
      message: 'This match was already registered with different data.',
    })
    const send = vi.fn<SendFn>().mockRejectedValue(conflict)
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick(10 * 60_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(outbox.getSnapshot(submission.matchId)?.error).toMatch(/different data/)
  })

  it('normalises unexpected throws (sync throw, plain Error) into a failed status', async () => {
    const a = makeSubmission()
    const b = makeSubmission()
    const send = vi.fn<SendFn>((s) => {
      if (s.matchId === a.matchId) throw new Error('sync boom')
      return Promise.reject(new Error('async boom'))
    })
    const outbox = make(send, { retryDelaysMs: [] })
    outbox.enqueue(a)
    outbox.enqueue(b)
    await tick()
    for (const s of [a, b]) {
      const view = outbox.getSnapshot(s.matchId)!
      expect(view.status).toBe('failed')
      expect(view.error).toBeTruthy()
      expect(view.error).not.toMatch(/boom/) // internal details are not surfaced
    }
  })

  it('fails when the server answers with a different record', async () => {
    const submission = makeSubmission()
    const other = makeSubmission()
    const outbox = make(async () => ok(other))
    outbox.enqueue(submission)
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('failed')
  })

  it('an in-flight retry is not duplicated by a scheduled one', async () => {
    const submission = makeSubmission()
    let calls = 0
    let resolve!: (r: SubmitMatchResponse) => void
    const send = vi.fn<SendFn>(() => {
      calls += 1
      if (calls === 1) return Promise.reject(outage())
      return new Promise((r) => (resolve = r))
    })
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick(2_000) // automatic retry starts and hangs
    expect(send).toHaveBeenCalledTimes(2)
    outbox.retry(submission.matchId)
    void outbox.flush()
    await tick()
    expect(send).toHaveBeenCalledTimes(2)
    resolve(ok(submission))
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })
})

describe('flush, online and refresh recovery', () => {
  it('flush re-sends everything persisted and resolves when settled', async () => {
    const a = makeSubmission()
    const b = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(outage())
    const outbox = make(send, { retryDelaysMs: [] })
    outbox.enqueue(a)
    outbox.enqueue(b)
    await tick()
    expect(send).toHaveBeenCalledTimes(2)
    send.mockImplementation(async (s) => ok(s))
    const flushed = outbox.flush()
    await tick()
    await flushed
    expect(send).toHaveBeenCalledTimes(4)
    expect(outbox.getSnapshot(a.matchId)?.status).toBe('synced')
    expect(outbox.getSnapshot(b.matchId)?.status).toBe('synced')
    expect(queued()).toBeNull()
  })

  it('the online event flushes pending entries', async () => {
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(outage())
    const outbox = make(send, { retryDelaysMs: [] })
    outbox.enqueue(submission)
    await tick()
    send.mockImplementation(async (s) => ok(s))
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('listenOnline: false ignores the online event; destroy removes the listener', async () => {
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(outage())
    const quiet = make(send, { retryDelaysMs: [], listenOnline: false })
    quiet.enqueue(submission)
    await tick()
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
    const loud = make(send, { retryDelaysMs: [] })
    loud.destroy()
    window.dispatchEvent(new Event('online'))
    await tick()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('recovers after a refresh: a new instance restores the queue and flush registers it once', async () => {
    const submission = makeSubmission()
    const first = make(vi.fn<SendFn>().mockRejectedValue(outage()), { retryDelaysMs: [] })
    first.enqueue(submission)
    await tick()
    first.destroy() // the page goes away

    const send = vi.fn<SendFn>(async (s) => ok(s))
    const second = make(send)
    expect(second.getSnapshot(submission.matchId)).toMatchObject({
      status: 'failed',
      error: 'Service unavailable.',
    })
    expect(send).not.toHaveBeenCalled() // recovery is explicit: the app calls flush on start
    await second.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toEqual(submission)
    expect(second.getSnapshot(submission.matchId)?.status).toBe('synced')
    expect(queued()).toBeNull()
  })

  it('an entry that never got a response (killed mid-request) comes back as pending', async () => {
    const submission = makeSubmission()
    const first = make(() => new Promise<SubmitMatchResponse>(() => {}))
    first.enqueue(submission)
    await tick()
    expect(first.getSnapshot(submission.matchId)?.status).toBe('syncing')
    first.destroy()
    const second = make(async (s) => ok(s))
    expect(second.getSnapshot(submission.matchId)?.status).toBe('pending')
  })

  it('remembers the last confirmed matches across refreshes (synced status and record)', async () => {
    const submission = makeSubmission()
    const first = make(async (s) => ok(s))
    first.enqueue(submission)
    await tick()
    first.destroy()
    expect(queued()).toBeNull()
    const second = make(vi.fn<SendFn>())
    const view = second.getSnapshot(submission.matchId)!
    expect(view.status).toBe('synced')
    expect(view.record?.matchId).toBe(submission.matchId)
    // enqueueing it again after a refresh must not re-send it
    second.enqueue(submission)
    await tick()
    expect(second.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('bounds the persisted synced map to the last 20 matches', async () => {
    const outbox = make(async (s) => ok(s))
    const subs = Array.from({ length: 25 }, () => makeSubmission())
    for (const s of subs) outbox.enqueue(s)
    await tick()
    const stored = JSON.parse(window.localStorage.getItem(SYNCED_STORAGE_KEY)!)
    expect(stored).toHaveLength(20)
    outbox.destroy()
    const fresh = make(async (s) => ok(s))
    expect(fresh.getSnapshot(subs[24]!.matchId)?.status).toBe('synced')
    expect(fresh.getSnapshot(subs[0]!.matchId)).toBeNull()
  })

  it('flush picks up entries written by another instance/tab', async () => {
    const other = makeSubmission()
    const a = make(vi.fn<SendFn>().mockRejectedValue(outage()), {
      retryDelaysMs: [],
      listenOnline: false,
    })
    const send = vi.fn<SendFn>(async (s) => ok(s))
    const b = make(send, { listenOnline: false })
    a.enqueue(other)
    await tick()
    expect(b.getSnapshot(other.matchId)).toBeNull()
    await b.flush()
    expect(send).toHaveBeenCalledWith(other, expect.anything())
  })
})

describe('tampered or corrupted storage', () => {
  const valid = makeSubmission()

  it.each([
    ['invalid JSON', '{not json'],
    ['a string', JSON.stringify('x')],
    ['an object', JSON.stringify({ a: 1 })],
    ['null', 'null'],
    ['numbers', JSON.stringify([1, 2, 3])],
  ])('ignores %s and starts empty', async (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEYS.outbox, raw)
    const send = vi.fn<SendFn>()
    const outbox = make(send)
    await outbox.flush()
    expect(send).not.toHaveBeenCalled()
    // a new entry still works and replaces the garbage
    const submission = makeSubmission()
    outbox.enqueue(submission)
    expect(pendingOutboxSchema.parse(queued())).toHaveLength(1)
  })

  it('keeps valid entries and drops forged ones (score, unknown keys, duplicates)', async () => {
    const forged = { submission: { ...valid, score: 9_999 }, attempts: 0, lastError: null }
    const extra = { submission: valid, attempts: 0, lastError: null, admin: true }
    const good = { submission: valid, attempts: 2, lastError: 'Service unavailable.' }
    window.localStorage.setItem(
      STORAGE_KEYS.outbox,
      JSON.stringify([forged, extra, good, { ...good, attempts: 7 }, 'garbage']),
    )
    const send = vi.fn<SendFn>(async (s) => ok(s))
    const outbox = make(send)
    // repaired immediately
    expect(pendingOutboxSchema.parse(queued())).toEqual([good])
    expect(outbox.getSnapshot(valid.matchId)).toMatchObject({ status: 'failed' })
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(valid, expect.anything())
  })

  it('ignores a tampered synced map', () => {
    window.localStorage.setItem(SYNCED_STORAGE_KEY, JSON.stringify([{ matchId: 'x' }]))
    const outbox = make(vi.fn<SendFn>())
    expect(outbox.getSnapshot('x')).toBeNull()
  })

  it('removes storage that only held corrupted entries', () => {
    window.localStorage.setItem(STORAGE_KEYS.outbox, JSON.stringify([{ nope: true }]))
    make(vi.fn<SendFn>())
    expect(queued()).toBeNull()
  })
})

describe('limits and reset', () => {
  it('keeps the persisted queue within the schema bound of 100 entries', async () => {
    const send = vi.fn<SendFn>().mockRejectedValue(rejected())
    const outbox = make(send)
    const subs = Array.from({ length: 103 }, () => makeSubmission())
    for (const s of subs) outbox.enqueue(s)
    await tick()
    const stored = pendingOutboxSchema.parse(queued()) // would throw if the bound were exceeded
    expect(stored).toHaveLength(100)
    // the newest entries are the ones kept
    expect(stored.at(-1)?.submission.matchId).toBe(subs[102]!.matchId)
    expect(outbox.getSnapshot(subs[102]!.matchId)?.status).toBe('failed')
  })

  it('reset clears queue, synced map, timers and ignores late completions', async () => {
    const pendingSub = makeSubmission()
    const doneSub = makeSubmission()
    const late = makeSubmission()
    let resolveLate!: (r: SubmitMatchResponse) => void
    let signalOfLate: AbortSignal | undefined
    const send = vi.fn<SendFn>((s, signal) => {
      if (s.matchId === doneSub.matchId) return Promise.resolve(ok(s))
      if (s.matchId === late.matchId) {
        signalOfLate = signal
        return new Promise((r) => (resolveLate = r))
      }
      return Promise.reject(outage())
    })
    const outbox = make(send)
    const listener = vi.fn()
    outbox.enqueue(doneSub)
    outbox.enqueue(pendingSub)
    outbox.enqueue(late)
    await tick()
    outbox.subscribe(listener)
    expect(vi.getTimerCount()).toBeGreaterThan(0) // pendingSub waits for its retry

    outbox.reset()
    expect(listener).toHaveBeenCalled()
    expect(signalOfLate?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(queued()).toBeNull()
    expect(window.localStorage.getItem(SYNCED_STORAGE_KEY)).toBeNull()
    for (const s of [doneSub, pendingSub, late]) expect(outbox.getSnapshot(s.matchId)).toBeNull()

    resolveLate(ok(late)) // arrives after the reset: must not resurrect anything
    await tick(60_000)
    expect(outbox.getSnapshot(late.matchId)).toBeNull()
    expect(queued()).toBeNull()
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('works normally after a reset', async () => {
    const outbox = make(async (s) => ok(s))
    outbox.reset()
    const submission = makeSubmission()
    outbox.enqueue(submission)
    await tick()
    expect(outbox.getSnapshot(submission.matchId)?.status).toBe('synced')
  })

  it('destroy stops timers and requests without wiping storage', async () => {
    const submission = makeSubmission()
    const send = vi.fn<SendFn>().mockRejectedValue(outage())
    const outbox = make(send)
    outbox.enqueue(submission)
    await tick()
    outbox.destroy()
    expect(vi.getTimerCount()).toBe(0)
    await tick(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(pendingOutboxSchema.parse(queued())).toHaveLength(1)
  })
})
