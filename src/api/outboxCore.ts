import { z } from 'zod'
import type { SubmitMatchResponse } from '../contracts/api.ts'
import {
  matchRecordSchema,
  matchSubmissionSchema,
  type MatchRecord,
  type MatchSubmission,
} from '../contracts/match.ts'
import {
  pendingOutboxSchema,
  pendingSubmissionSchema,
  type PendingSubmission,
  type SubmissionStatus,
} from '../contracts/outbox.ts'
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '../lib/storage.ts'
import { ApiError, MESSAGES, toApiError } from './errors.ts'

/**
 * Persistent match-submission outbox.
 *
 *   enqueue --> persisted --> pending --> syncing --> synced   (removed from the persisted queue)
 *                                            |
 *                                            +-------> failed  (stays queued; auto retry with
 *                                                              backoff if transient, manual retry,
 *                                                              `flush`, or the `online` event)
 *
 * Guarantees:
 *  - the entry is written to localStorage BEFORE the first request;
 *  - every request for a match carries the same `matchId`, so the server is idempotent; 201 and
 *    200 `duplicate: true` are both success;
 *  - at most one request per matchId is in flight (single-flight);
 *  - nothing here throws to the caller: failures surface through the snapshot `status`/`error`;
 *  - many entries can be queued at once; a pending one never blocks playing another match.
 */

/** Delays of the automatic retries. After the last one the entry waits for a manual trigger. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const

/**
 * Last confirmed records, kept so the result screen can still show `synced` after a refresh.
 * (Not part of `STORAGE_KEYS`, which lives outside this module's ownership.)
 */
export const SYNCED_STORAGE_KEY = 'pirate-battle:outbox-synced'

const MAX_QUEUE = 100
const MAX_SYNCED = 20
const syncedRecordsSchema = z.array(matchRecordSchema).max(MAX_SYNCED)
const INVALID_MESSAGE = 'This match result is invalid and cannot be sent.'

/** Immutable, referentially stable while unchanged (safe for `useSyncExternalStore`). */
export interface SubmissionView {
  readonly status: SubmissionStatus
  readonly record: MatchRecord | null
  readonly error: string | null
}

export interface OutboxDeps {
  /** One HTTP attempt. Must reject with `ApiError` (or anything: it is normalised). */
  send: (submission: MatchSubmission, signal: AbortSignal) => Promise<SubmitMatchResponse>
  /** Called once per match when the server confirms it. */
  onSynced?: (record: MatchRecord) => void
  retryDelaysMs?: readonly number[]
  /** Flush when the browser reports `online` (default true). */
  listenOnline?: boolean
}

export interface Outbox {
  enqueue: (submission: MatchSubmission) => void
  retry: (matchId: string) => void
  /** Re-sends everything persisted; resolves when all attempts settled. */
  flush: () => Promise<void>
  subscribe: (listener: () => void) => () => void
  getSnapshot: (matchId: string | null) => SubmissionView | null
  /** Drops everything (queue, synced map, timers, in-flight requests). */
  reset: () => void
  /** Stops timers, requests and listeners without touching storage (tests / teardown). */
  destroy: () => void
}

interface Entry {
  submission: MatchSubmission
  status: SubmissionStatus
  attempts: number
  lastError: string | null
  record: MatchRecord | null
  /** Invalid input: kept in memory only, never sent. */
  invalid: boolean
}

interface Flight {
  controller: AbortController
  promise: Promise<void>
}

/** Reads the persisted queue, salvaging valid entries when some are corrupted or tampered. */
function loadPersistedQueue(): PendingSubmission[] {
  const raw = readStorage(STORAGE_KEYS.outbox, z.unknown(), null)
  if (raw === null) return []
  const whole = pendingOutboxSchema.safeParse(raw)
  if (whole.success) return dedupe(whole.data)
  const salvaged: PendingSubmission[] = []
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0, MAX_QUEUE * 2)) {
      const parsed = pendingSubmissionSchema.safeParse(item)
      if (parsed.success) salvaged.push(parsed.data)
    }
  }
  const clean = dedupe(salvaged).slice(0, MAX_QUEUE)
  // Repair storage right away so the corruption is not re-read forever.
  if (clean.length > 0) writeStorage(STORAGE_KEYS.outbox, clean)
  else removeStorage(STORAGE_KEYS.outbox)
  return clean
}

function dedupe(queue: PendingSubmission[]): PendingSubmission[] {
  const seen = new Set<string>()
  return queue.filter((item) => {
    if (seen.has(item.submission.matchId)) return false
    seen.add(item.submission.matchId)
    return true
  })
}

function loadSyncedRecords(): MatchRecord[] {
  return readStorage(SYNCED_STORAGE_KEY, syncedRecordsSchema, [])
}

export function createOutbox(deps: OutboxDeps): Outbox {
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS
  const entries = new Map<string, Entry>()
  const views = new Map<string, SubmissionView>()
  const flights = new Map<string, Flight>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const autoRetries = new Map<string, number>()
  const listeners = new Set<() => void>()
  let syncedRecords: MatchRecord[] = []
  // Bumped by reset(): completions of requests started before it are ignored.
  let generation = 0
  let destroyed = false

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // one faulty subscriber must not break the outbox or the other subscribers
      }
    }
  }

  function refreshView(matchId: string, entry: Entry): void {
    const next: SubmissionView = {
      status: entry.status,
      record: entry.record,
      error: entry.status === 'failed' ? entry.lastError : null,
    }
    const previous = views.get(matchId)
    if (
      previous &&
      previous.status === next.status &&
      previous.record === next.record &&
      previous.error === next.error
    ) {
      return
    }
    views.set(matchId, next)
  }

  function persistQueue(): void {
    const queue: PendingSubmission[] = []
    for (const entry of entries.values()) {
      if (entry.invalid || entry.status === 'synced') continue
      queue.push({
        submission: entry.submission,
        attempts: Math.min(entry.attempts, 1_000),
        lastError: entry.lastError,
      })
    }
    if (queue.length === 0) removeStorage(STORAGE_KEYS.outbox)
    else writeStorage(STORAGE_KEYS.outbox, queue)
  }

  function rememberSynced(record: MatchRecord): void {
    syncedRecords = [record, ...syncedRecords.filter((r) => r.matchId !== record.matchId)].slice(
      0,
      MAX_SYNCED,
    )
    writeStorage(SYNCED_STORAGE_KEY, syncedRecords)
  }

  /** Adds persisted entries this instance does not know yet (refresh, another tab). */
  function hydrate(queue: PendingSubmission[]): void {
    let changed = false
    for (const item of queue) {
      const id = item.submission.matchId
      if (entries.has(id) || syncedRecords.some((r) => r.matchId === id)) continue
      const entry: Entry = {
        submission: item.submission,
        status: item.lastError === null ? 'pending' : 'failed',
        attempts: item.attempts,
        lastError: item.lastError,
        record: null,
        invalid: false,
      }
      entries.set(id, entry)
      refreshView(id, entry)
      changed = true
    }
    if (changed) notify()
  }

  function clearTimer(matchId: string): void {
    const handle = timers.get(matchId)
    if (handle !== undefined) clearTimeout(handle)
    timers.delete(matchId)
  }

  function scheduleAutoRetry(matchId: string, error: ApiError): void {
    if (destroyed || !error.retryable) return
    const done = autoRetries.get(matchId) ?? 0
    const delay = delays[done]
    if (delay === undefined) return // backoff exhausted: wait for manual retry / flush / online
    autoRetries.set(matchId, done + 1)
    clearTimer(matchId)
    timers.set(
      matchId,
      setTimeout(() => {
        timers.delete(matchId)
        void send(matchId)
      }, delay),
    )
  }

  function markSynced(matchId: string, entry: Entry, record: MatchRecord): void {
    entry.status = 'synced'
    entry.record = record
    entry.lastError = null
    clearTimer(matchId)
    autoRetries.delete(matchId)
    rememberSynced(record)
    persistQueue() // the entry leaves the persisted queue before anyone is notified
    refreshView(matchId, entry)
    notify()
    try {
      deps.onSynced?.(record)
    } catch {
      // invalidation problems must never turn a confirmed match into a failure
    }
  }

  function markFailed(matchId: string, entry: Entry, error: ApiError): void {
    entry.status = 'failed'
    entry.lastError = error.message.slice(0, 500)
    persistQueue()
    refreshView(matchId, entry)
    notify()
    scheduleAutoRetry(matchId, error)
  }

  async function run(matchId: string, entry: Entry, flight: Flight, ticket: number): Promise<void> {
    let confirmed: MatchRecord | null = null
    let failure: ApiError | null = null
    try {
      const response = await deps.send(entry.submission, flight.controller.signal)
      if (response.record.matchId !== matchId) {
        throw new ApiError({ kind: 'invalid_response', message: MESSAGES.invalidResponse })
      }
      confirmed = response.record
    } catch (error) {
      failure = toApiError(error)
    }
    // Leave the single-flight slot first so observers reacting below may retry right away.
    if (flights.get(matchId) === flight) flights.delete(matchId)
    if (ticket !== generation) return // reset()/destroy() happened while the request was running
    if (confirmed) markSynced(matchId, entry, confirmed)
    else if (failure) markFailed(matchId, entry, failure)
  }

  /** Single-flight: a second call while a request is running joins the running one. */
  function send(matchId: string): Promise<void> {
    const running = flights.get(matchId)
    if (running) return running.promise
    const entry = entries.get(matchId)
    if (destroyed || !entry || entry.invalid || entry.status === 'synced') return Promise.resolve()
    clearTimer(matchId)
    entry.status = 'syncing'
    entry.attempts += 1
    persistQueue()
    refreshView(matchId, entry)
    notify()
    const flight: Flight = { controller: new AbortController(), promise: Promise.resolve() }
    flights.set(matchId, flight)
    flight.promise = run(matchId, entry, flight, generation)
    return flight.promise
  }

  function schedule(matchId: string): void {
    // Deferred by a microtask so `pending` is observable and same-tick duplicates collapse.
    void Promise.resolve().then(() => send(matchId))
  }

  function enqueue(input: MatchSubmission): void {
    try {
      const parsed = matchSubmissionSchema.safeParse(input)
      if (!parsed.success) {
        const rawId: unknown = (input as { matchId?: unknown } | null)?.matchId
        if (typeof rawId === 'string' && !entries.has(rawId) && rawId.length <= 64) {
          const entry: Entry = {
            submission: input,
            status: 'failed',
            attempts: 0,
            lastError: INVALID_MESSAGE,
            record: null,
            invalid: true,
          }
          entries.set(rawId, entry)
          refreshView(rawId, entry)
          notify()
        }
        return
      }
      const submission = parsed.data
      const id = submission.matchId
      const existing = entries.get(id)
      if (existing) {
        // Repeated call (Strict Mode, double click): never a second entry, at most a kick.
        if (existing.status === 'pending') schedule(id)
        return
      }
      if (syncedRecords.some((r) => r.matchId === id)) return
      hydrate(loadPersistedQueue()) // pick up the persisted queue first so it is not overwritten
      if (entries.has(id)) return
      makeRoom()
      const entry: Entry = {
        submission,
        status: 'pending',
        attempts: 0,
        lastError: null,
        record: null,
        invalid: false,
      }
      entries.set(id, entry)
      persistQueue() // durable BEFORE the first request
      refreshView(id, entry)
      notify()
      schedule(id)
    } catch {
      // never throw to the caller
    }
  }

  /** Keeps the persisted queue within its schema bound: drop the oldest non-sending entry. */
  function makeRoom(): void {
    const persisted = [...entries.entries()].filter(([, e]) => !e.invalid && e.status !== 'synced')
    if (persisted.length < MAX_QUEUE) return
    const victim =
      persisted.find(([id, e]) => e.status === 'failed' && !flights.has(id)) ??
      persisted.find(([id]) => !flights.has(id))
    if (!victim) return
    const [victimId] = victim
    clearTimer(victimId)
    entries.delete(victimId)
    views.delete(victimId)
    autoRetries.delete(victimId)
  }

  function retry(matchId: string): void {
    try {
      if (!entries.has(matchId)) hydrate(loadPersistedQueue())
      const entry = entries.get(matchId)
      if (!entry || entry.invalid || entry.status === 'synced') return
      autoRetries.delete(matchId)
      clearTimer(matchId)
      void send(matchId)
    } catch {
      // never throw to the caller
    }
  }

  async function flush(): Promise<void> {
    try {
      hydrate(loadPersistedQueue())
      const ids = [...entries.entries()]
        .filter(([, e]) => !e.invalid && e.status !== 'synced')
        .map(([id]) => id)
      for (const id of ids) {
        autoRetries.delete(id)
        clearTimer(id)
      }
      await Promise.all(ids.map((id) => send(id)))
    } catch {
      // never throw to the caller
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getSnapshot(matchId: string | null): SubmissionView | null {
    return matchId === null ? null : (views.get(matchId) ?? null)
  }

  function stopWork(): void {
    for (const flight of flights.values()) flight.controller.abort()
    flights.clear()
    for (const handle of timers.values()) clearTimeout(handle)
    timers.clear()
    autoRetries.clear()
  }

  function reset(): void {
    generation += 1
    stopWork()
    entries.clear()
    views.clear()
    syncedRecords = []
    removeStorage(STORAGE_KEYS.outbox)
    removeStorage(SYNCED_STORAGE_KEY)
    notify()
  }

  const onOnline = (): void => {
    void flush()
  }
  const listenOnline = deps.listenOnline ?? true
  if (listenOnline && typeof window !== 'undefined') window.addEventListener('online', onOnline)

  function destroy(): void {
    destroyed = true
    generation += 1
    stopWork()
    listeners.clear()
    if (listenOnline && typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
    }
  }

  // Refresh recovery: restore what was confirmed and what is still queued.
  syncedRecords = loadSyncedRecords()
  for (const record of syncedRecords) {
    views.set(record.matchId, { status: 'synced', record, error: null })
  }
  hydrate(loadPersistedQueue())

  return { enqueue, retry, flush, subscribe, getSnapshot, reset, destroy }
}
