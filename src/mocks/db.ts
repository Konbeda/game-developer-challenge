import { z } from 'zod'
import {
  matchRecordSchema,
  sameConfig,
  type MatchConfig,
  type MatchRecord,
  type MatchSubmission,
} from '../contracts/match.ts'
import type { ScenarioId } from '../contracts/scenarios.ts'
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '../lib/storage.ts'
import {
  FIXTURE_ID_PREFIX,
  getBaseFixtures,
  getBaseFixturesForConfig,
  getManyPagesExtra,
  getManyPagesHistory,
} from './fixtures.ts'

/**
 * The mock "server database": deterministic fixtures + the records this browser confirmed.
 * Only confirmed records are persisted (localStorage `mockDb`); fixtures are regenerated, so
 * "reset" simply forgets the confirmed ones. Every read validates the stored data with zod; a
 * corrupted or tampered value is discarded (treated as an empty database) and repaired on the next
 * write.
 */
const MAX_CONFIRMED = 500

const mockDbSchema = z.strictObject({
  version: z.literal(1),
  records: z.array(matchRecordSchema).max(MAX_CONFIRMED),
})

// When localStorage is missing (Node tests) or refuses writes (private mode), the session keeps
// working from memory.
let memoryRecords: MatchRecord[] = []
let memoryOnly = false

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage !== undefined
  } catch {
    return false
  }
}

function sanitize(records: readonly MatchRecord[]): MatchRecord[] {
  const seen = new Set<string>()
  const clean: MatchRecord[] = []
  for (const record of records) {
    // Ids of fixtures are reserved, and a matchId can exist only once.
    if (record.matchId.startsWith(FIXTURE_ID_PREFIX) || seen.has(record.matchId)) continue
    seen.add(record.matchId)
    clean.push(record)
  }
  return clean
}

/** Confirmed records of this browser, oldest first. */
export function getConfirmedRecords(): MatchRecord[] {
  if (memoryOnly || !hasStorage()) return memoryRecords
  const db = readStorage(STORAGE_KEYS.mockDb, mockDbSchema, { version: 1 as const, records: [] })
  return sanitize(db.records)
}

function saveConfirmed(records: MatchRecord[]): void {
  memoryRecords = records
  if (memoryOnly || !hasStorage()) return
  if (!writeStorage(STORAGE_KEYS.mockDb, { version: 1, records })) memoryOnly = true
}

/** Restores fixtures only (drops every confirmed record). */
export function resetDb(): void {
  memoryRecords = []
  memoryOnly = false
  removeStorage(STORAGE_KEYS.mockDb)
}

/** Records competing in the ranking of `config`. */
export function rankingSource(config: MatchConfig, scenario: ScenarioId): MatchRecord[] {
  const confirmed = getConfirmedRecords().filter((r) => sameConfig(r.config, config))
  const fixtures = getBaseFixturesForConfig(config)
  return scenario === 'many_pages'
    ? [...fixtures, ...getManyPagesExtra(config), ...confirmed]
    : [...fixtures, ...confirmed]
}

/** Records of `playerId` (own confirmed matches; fixtures for fixture players). */
export function historySource(playerId: string, scenario: ScenarioId): MatchRecord[] {
  const confirmed = getConfirmedRecords().filter((r) => r.playerId === playerId)
  const fixtures = getBaseFixtures().filter((r) => r.playerId === playerId)
  return scenario === 'many_pages'
    ? [...fixtures, ...getManyPagesHistory(playerId), ...confirmed]
    : [...fixtures, ...confirmed]
}

export type CommitResult =
  | { kind: 'created'; record: MatchRecord }
  | { kind: 'duplicate'; record: MatchRecord }
  | { kind: 'conflict'; reason: 'different_payload' | 'reserved_id' }

function samePayload(record: MatchRecord, submission: MatchSubmission): boolean {
  return (
    record.playerId === submission.playerId &&
    record.playerName === submission.playerName &&
    record.playedAt === submission.playedAt &&
    record.score === submission.score &&
    record.durationMs === submission.durationMs &&
    record.endReason === submission.endReason &&
    record.seed === submission.seed &&
    sameConfig(record.config, submission.config)
  )
}

/**
 * Idempotent registration keyed by `matchId`:
 *  - unknown id            -> created
 *  - known id, same body   -> duplicate (the stored record, unchanged)
 *  - known id, other body  -> conflict
 * `submission` must already be validated by `matchSubmissionSchema`.
 */
export function commitSubmission(submission: MatchSubmission, recordedAt: string): CommitResult {
  if (submission.matchId.startsWith(FIXTURE_ID_PREFIX)) {
    return { kind: 'conflict', reason: 'reserved_id' }
  }
  const confirmed = getConfirmedRecords()
  const existing = confirmed.find((r) => r.matchId === submission.matchId)
  if (existing) {
    return samePayload(existing, submission)
      ? { kind: 'duplicate', record: existing }
      : { kind: 'conflict', reason: 'different_payload' }
  }
  const record: MatchRecord = {
    matchId: submission.matchId,
    playerId: submission.playerId,
    playerName: submission.playerName,
    playedAt: submission.playedAt,
    score: submission.score,
    durationMs: submission.durationMs,
    endReason: submission.endReason,
    config: { ...submission.config },
    seed: submission.seed,
    recordedAt,
  }
  const next = [...confirmed, record]
  // Keep the newest records if the (mock) database ever fills up.
  const bounded =
    next.length > MAX_CONFIRMED
      ? [...next].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)).slice(0, MAX_CONFIRMED)
      : next
  saveConfirmed(bounded)
  return { kind: 'created', record }
}
