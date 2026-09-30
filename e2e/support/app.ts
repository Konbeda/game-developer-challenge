import { expect, type Page } from '@playwright/test'
import type { MatchConfig } from '../../src/contracts/match.ts'
import type { ScenarioId } from '../../src/contracts/scenarios.ts'
import { STORAGE_KEYS } from '../../src/lib/storage.ts'

/** Player identity pre-seeded by `openApp` unless a test asks to go through the name prompt. */
export const SEEDED_PLAYER = { playerId: 'e2e-player-0001', playerName: 'Tester' } as const

/**
 * A config no fixture player has played (fixtures cover 60/3s, 90/3s, 90/2s, 120/3s and 180/5s), so the
 * ranking of a fresh browser is empty and the player's own match is the only entry (rank 1).
 */
export const EMPTY_BOARD_CONFIG: MatchConfig = { sessionSeconds: 60, spawnIntervalMs: 2_500 }

/**
 * 60 s sessions with an enemy every 10 s: `playBotToEnd` survives it (`time_up`, score 5 with seed 1).
 * No fixture player has this config either, so its ranking starts empty.
 */
export const TIME_UP_CONFIG: MatchConfig = { sessionSeconds: 60, spawnIntervalMs: 10_000 }

export interface OpenAppOptions {
  /** `?scenario=<id>`: network scenario for this page load (default: the app's `success`). */
  scenario?: ScenarioId
  /**
   * `?latencyMs=`: fixed mock latency for every scenario. Default 0 (instant). Pass `null` to omit it,
   * which lets `slow`, `variable_latency` and `out_of_order` use their own planned latencies.
   */
  latencyMs?: number | null
  /** `?mockSeed=`: seed of the variable-latency PRNG. Default 1. */
  mockSeed?: number
  /** `?retry=`: automatic GET retries of the client. Default 0 (errors show immediately). */
  retry?: number
  /** `?timeoutMs=`: client request timeout (50..30000). Omitted by default (app default 8 s). */
  timeoutMs?: number
  /** `?clock=`: `manual` (default) stops the game loop until the test calls `advance`; `realtime` keeps it running. */
  clock?: 'manual' | 'realtime'
  /** `?seed=`: simulation seed of the first match of each game screen. Default 1. */
  seed?: number
  /** `?touch=1`: force the on-screen touch controls (needed on the desktop project). */
  touch?: boolean
  /**
   * How the first-visit "Welcome, Captain" prompt is handled:
   *  - `seed` (default): a stored profile (`name`, default "Tester") is pre-seeded, so no prompt appears;
   *  - `type`: the prompt is answered through the UI with `name`;
   *  - `skip`: the prompt's Skip button is pressed (player stays "Captain");
   *  - `open`: nothing is done, the prompt stays open (for tests of the prompt itself).
   */
  profile?: 'seed' | 'type' | 'skip' | 'open'
  /** Player name for `profile: 'seed' | 'type'`. Default "Tester". */
  name?: string
  /** Options pre-seeded in localStorage (only when the key is absent, so reloads keep what the app saved). */
  config?: MatchConfig
  /** Extra raw localStorage entries seeded before the app boots (only when the key is absent). */
  storage?: Record<string, string>
  /** Path to open. Default `/`. */
  path?: string
  /** Do not wait for the main menu (use with `profile: 'open'` or paths that do not show the menu). */
  waitForMenu?: boolean
}

function buildQuery(options: OpenAppOptions): string {
  const params = new URLSearchParams()
  if (options.scenario) params.set('scenario', options.scenario)
  const latency = options.latencyMs === undefined ? 0 : options.latencyMs
  if (latency !== null) params.set('latencyMs', String(latency))
  params.set('mockSeed', String(options.mockSeed ?? 1))
  params.set('retry', String(options.retry ?? 0))
  if (options.timeoutMs !== undefined) params.set('timeoutMs', String(options.timeoutMs))
  if ((options.clock ?? 'manual') === 'manual') params.set('clock', 'manual')
  params.set('seed', String(options.seed ?? 1))
  if (options.touch) params.set('touch', '1')
  return params.toString()
}

/** Builds the localStorage entries the app would find after earlier visits. */
function buildSeedEntries(options: OpenAppOptions): Record<string, string> {
  const entries: Record<string, string> = {}
  if ((options.profile ?? 'seed') === 'seed') {
    entries[STORAGE_KEYS.player] = JSON.stringify({
      playerId: SEEDED_PLAYER.playerId,
      playerName: options.name ?? SEEDED_PLAYER.playerName,
    })
  }
  if (options.config) entries[STORAGE_KEYS.options] = JSON.stringify(options.config)
  return { ...entries, ...options.storage }
}

/**
 * Opens the app with the test controls in the query string and waits until it is usable:
 * the mock service worker controls the page (so `/api/*` is answered by MSW, never by the server)
 * and, unless `waitForMenu: false`, the main menu is visible.
 *
 * Each Playwright test gets a fresh browser context, so localStorage, IndexedDB and the service
 * worker always start empty; seeded entries are written only when absent, so a `page.reload()`
 * keeps whatever the app itself stored in between.
 */
export async function openApp(page: Page, options: OpenAppOptions = {}): Promise<void> {
  const entries = buildSeedEntries(options)
  await page.addInitScript((seed: Record<string, string>) => {
    try {
      for (const [key, value] of Object.entries(seed)) {
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value)
      }
    } catch {
      // about:blank and similar documents have no storage
    }
  }, entries)

  await page.goto(`${options.path ?? '/'}?${buildQuery(options)}`)
  await waitForBoot(page)

  const profile = options.profile ?? 'seed'
  if (profile === 'type') {
    await expect(page.getByTestId('name-dialog')).toBeVisible()
    await page.getByTestId('name-input').fill(options.name ?? SEEDED_PLAYER.playerName)
    await page.getByTestId('name-submit').click()
    await expect(page.getByTestId('name-dialog')).toBeHidden()
  } else if (profile === 'skip') {
    await expect(page.getByTestId('name-dialog')).toBeVisible()
    await page.getByTestId('name-skip').click()
    await expect(page.getByTestId('name-dialog')).toBeHidden()
  } else if (profile === 'open') {
    await expect(page.getByTestId('name-dialog')).toBeVisible()
  }
  if (options.waitForMenu ?? true) await expect(page.getByTestId('screen-menu')).toBeVisible()
}

/**
 * Waits until the React app rendered and MSW controls the page. Also used after `page.reload()`
 * (`reloadApp`). Fails loudly when the mock worker did not start: every network test would
 * otherwise time out against a server that has no `/api`.
 */
export async function waitForBoot(page: Page): Promise<void> {
  await expect(page.locator('#root > *').first()).toBeAttached()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
      message: 'the MSW service worker should control the page',
    })
    .toBe(true)
}

/** `page.reload()` followed by the same readiness wait as `openApp`. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload()
  await waitForBoot(page)
}
