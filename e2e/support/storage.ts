import { expect, type Page } from '@playwright/test'
import type { MatchConfig, MatchRecord, MatchSubmission } from '../../src/contracts/match.ts'
import type { PendingSubmission } from '../../src/contracts/outbox.ts'
import { STORAGE_KEYS } from '../../src/lib/storage.ts'

/** Reads and parses one localStorage entry (`null` when absent). */
export async function readStorageJson<T = unknown>(page: Page, key: string): Promise<T | null> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), key)
  return raw === null ? null : (JSON.parse(raw) as T)
}

export function writeStorageRaw(page: Page, key: string, value: string): Promise<void> {
  return page.evaluate(([k, v]) => window.localStorage.setItem(k!, v!), [key, value])
}

/** Saved options (`null` until the player saves). */
export function readOptions(page: Page): Promise<MatchConfig | null> {
  return readStorageJson<MatchConfig>(page, STORAGE_KEYS.options)
}

/** The last completed match, as persisted for the menu's "Last match" card. */
export function readLastResult(page: Page): Promise<MatchSubmission | null> {
  return readStorageJson<MatchSubmission>(page, STORAGE_KEYS.lastResult)
}

/** Submissions still waiting to be confirmed by the (mock) server. */
export async function readOutbox(page: Page): Promise<PendingSubmission[]> {
  return (await readStorageJson<PendingSubmission[]>(page, STORAGE_KEYS.outbox)) ?? []
}

/** Records the mock server confirmed for this browser (the mock "database"). */
export async function readConfirmedRecords(page: Page): Promise<MatchRecord[]> {
  const db = await readStorageJson<{ records: MatchRecord[] }>(page, STORAGE_KEYS.mockDb)
  return db?.records ?? []
}

export function readPlayer(page: Page): Promise<{ playerId: string; playerName: string } | null> {
  return readStorageJson(page, STORAGE_KEYS.player)
}

/** Polls until the persisted outbox is empty: every finished match was confirmed. */
export async function waitForOutboxIdle(page: Page, timeout = 10_000): Promise<void> {
  await expect
    .poll(async () => (await readOutbox(page)).length, {
      message: 'the outbox should drain once the API accepts the matches',
      timeout,
    })
    .toBe(0)
}

/** Snapshot of everything a match may leave behind, to prove an abandoned match records nothing. */
export async function persistedMatchState(page: Page): Promise<{
  lastResult: MatchSubmission | null
  outbox: PendingSubmission[]
  confirmed: MatchRecord[]
}> {
  return {
    lastResult: await readLastResult(page),
    outbox: await readOutbox(page),
    confirmed: await readConfirmedRecords(page),
  }
}
