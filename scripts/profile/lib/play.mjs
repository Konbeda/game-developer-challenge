import { perfMetrics } from './browser.mjs'
import { KeyBot, leaveViaPause, readState, selectors, sleep, startMatch } from './game.mjs'

const { t } = selectors

/** The game's own sampler, read while its host is still alive (raw frames are a runtime-only detail). */
function readGameSampler(page) {
  return page
    .evaluate(() => {
      const perf = window.__perf
      if (!perf) return null
      const frames = Array.isArray(perf.frames)
        ? perf.frames.map((v) => Math.round(v * 1000) / 1000)
        : null
      return { summary: perf.summary(), frames }
    })
    .catch(() => null)
}

/**
 * Plays one match in REAL TIME with the keyboard bot (this is the one place where profiling has
 * to wait on the wall clock: the simulation follows real frame time, there is no manual clock in
 * the production build).
 *
 * Stops when the match ends by itself (death or time up), when `budgetMs` of combat frames have
 * been recorded in total, or after `playMs` of wall time. In the last two cases the match is left
 * through the pause dialog, like a player abandoning it.
 */
export async function playMatch(
  { page, cdp },
  { playSelector, budgetMs = Infinity, playMs = Infinity, turnMs = 3000, heapEveryMs = 1000 },
) {
  const { loadMs } = await startMatch(page, playSelector ? { playSelector } : {})
  const bot = new KeyBot(page, { turnMs })
  const first = await readState(page)
  const runMsAtStart = first.runMs ?? 0
  const t0 = performance.now()
  const heapSeries = []
  let nextHeap = t0
  let state = first
  let endedBy = null

  for (;;) {
    const elapsed = performance.now() - t0
    await bot.tick(elapsed)
    state = await readState(page)
    if (state.phase !== 'running') {
      endedBy = state.health === 0 ? 'death' : 'time_up'
      break
    }
    if ((state.runMs ?? 0) - runMsAtStart >= budgetMs) {
      endedBy = 'budget'
      break
    }
    if (elapsed >= playMs) {
      endedBy = 'play_time'
      break
    }
    if (performance.now() >= nextHeap) {
      const metrics = await perfMetrics(cdp)
      heapSeries.push([
        Math.round(elapsed / 100) / 10,
        Math.round((metrics.JSHeapUsedSize / 1024 / 1024) * 100) / 100,
      ])
      nextHeap = performance.now() + heapEveryMs
    }
    await sleep(100)
  }
  const wallMs = performance.now() - t0
  await bot.releaseAll()

  // Read the game's own sampler before anything is torn down (phase 'ended' keeps the host for 1.3 s).
  const gameSampler = await readGameSampler(page)

  if (endedBy === 'budget' || endedBy === 'play_time') {
    await leaveViaPause(page)
  } else {
    await page.locator(t('screen-result')).first().waitFor({ timeout: 15_000 })
  }
  return {
    endedBy,
    loadMs,
    wallSeconds: Math.round(wallMs) / 1000,
    final: { score: state.score, time: state.time, health: state.health },
    heapSeries,
    gameSampler,
  }
}
