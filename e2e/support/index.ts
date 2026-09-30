/**
 * Shared E2E helpers for the app/network specs. Import from `../support/index.ts`.
 * The API below is stable: other specs (e.g. `e2e/game/**`) may rely on it.
 *
 * fixtures.ts
 *   test, expect                       Playwright test with the fixtures below.
 *   fixture `app`                      App page objects + `app.open(opts)` / `app.reload()`.
 *   auto fixture `consoleErrors`       fails the test on console.error / pageerror. Options (test.use):
 *                                      `allowNetworkErrors: true` tolerates Chromium's "Failed to load
 *                                      resource" / "net::ERR_" lines (outage scenarios only),
 *                                      `allowedConsoleErrors: RegExp[]` tolerates specific messages.
 *   Isolation: every test gets a fresh browser context, so localStorage/IndexedDB/service worker are
 *   empty at the start; `openApp` seeds only what a test asks for.
 *
 * app.ts
 *   openApp(page, options)             query controls + first-visit name prompt + boot wait. Options:
 *                                      scenario, latencyMs (default 0, null = omit), mockSeed (1), retry (0),
 *                                      timeoutMs, clock ('manual' default | 'realtime'), seed (1), touch,
 *                                      profile ('seed' default | 'type' | 'skip' | 'open'), name, config,
 *                                      storage (raw localStorage seeds), path, waitForMenu.
 *   reloadApp(page), waitForBoot(page) reload / wait for React + the MSW worker.
 *   SEEDED_PLAYER, EMPTY_BOARD_CONFIG  default test identity; a config with no fixture entries.
 *
 * game.ts   (window.__game test hook: manual clock)
 *   startMatch(page)                   click Play on the menu, wait until the simulation exists.
 *   waitForMatch(page), hasMatch(page)
 *   advance(page, ms)                  run whole fixed steps with the currently held inputs.
 *   snapshot(page), hud(page)          SimSnapshot / HudState.
 *   finishMatch(page)                  play to the end idle, wait for the result screen, return the
 *                                      persisted MatchSubmission. playMatchToResult = start + finish.
 *   touchPress/touchRelease(page, action, pointerId)  synthetic touch pointers on the touch controls.
 *   projectilesBy(snapshot, owner)
 *
 * pages.ts   page objects: App { menu, options, log, game, result, nameDialog, scenarios } with
 *            lazy locators and small flows (openLog, openOptions, backToMenu, ScenarioPanel.select).
 * storage.ts localStorage readers: readOptions, readLastResult, readOutbox, readConfirmedRecords,
 *            readPlayer, readStorageJson, writeStorageRaw, waitForOutboxIdle, persistedMatchState.
 * network.ts trackApi(page)            counts `/api/*` requests/responses (MSW-answered ones included).
 */
export * from './app.ts'
export * from './fixtures.ts'
export * from './game.ts'
export * from './network.ts'
export * from './pages.ts'
export * from './storage.ts'
