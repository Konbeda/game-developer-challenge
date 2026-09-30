import {
  forceGc,
  gpuFeatureStatus,
  launchBrowser,
  newSession,
  perfMetrics,
  processStats,
  webglInfo,
} from '../lib/browser.mjs'
import { startCpuMonitor } from '../lib/env.mjs'
import { configureMatch, measureRefreshHz, openApp } from '../lib/game.mjs'
import { playMatch } from '../lib/play.mjs'
import { frameStats, mean, round, windowed } from '../lib/stats.mjs'

const PLAY_AGAIN = 'result-play-again'

/** Counters worth diffing between two Performance.getMetrics readings. */
const COUNTERS = [
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'V8CompileDuration',
  'LayoutCount',
  'RecalcStyleCount',
  'Nodes',
  'JSEventListeners',
  'JSHeapUsedSize',
  'JSHeapTotalSize',
  'Timestamp',
]

const pick = (metrics) => Object.fromEntries(COUNTERS.map((name) => [name, metrics[name]]))
const mb = (bytes) => round(bytes / 1024 / 1024, 2)

/**
 * One combat profile: opens the production build, configures the match through Options, and plays
 * real-time matches with the keyboard bot until `targetSeconds` of combat frames are recorded.
 * A blind bot dies within seconds, so the target is reached by chaining matches (Play Again) and
 * summing their combat frames; each match is also reported on its own.
 */
export async function runCombat(config, url, log) {
  const {
    id,
    label,
    browser = 'chrome',
    headless = false,
    uncapped = false,
    viewport = { width: 1920, height: 1080 },
    dpr = 1,
    mobile = false,
    cpuThrottle = 1,
    targetSeconds = 180,
    sessionSeconds = 180,
    spawnSeconds = 0.5,
  } = config

  const launched = await launchBrowser({ browser, headless, uncapped })
  const { instance } = launched
  const cpuMonitor = startCpuMonitor()
  try {
    const session = await newSession(instance, { viewport, dpr, mobile, cpuThrottle })
    const { page, cdp } = session
    const browserCdp = await instance.newBrowserCDPSession()

    await openApp(page, url)
    const options = await configureMatch(page, { sessionSeconds, spawnSeconds })
    const production = await page.evaluate(() => ({
      hasE2eHook: typeof window.__game !== 'undefined',
    }))
    if (production.hasE2eHook)
      throw new Error('window.__game exists: this is not the production build')

    const webgl = await webglInfo(page)
    const gpu = await gpuFeatureStatus(browserCdp)
    const refreshHz = await measureRefreshHz(page)
    log(
      `  [${id}] ${launched.browser} ${instance.version()} headless=${launched.headless} gl=${webgl?.renderer} rAF=${refreshHz}Hz`,
    )

    await forceGc(cdp)
    const before = pick(await perfMetrics(cdp))
    const processesBefore = await processStats(browserCdp)

    const matches = []
    const allDt = []
    const gameDt = []
    const heapSeries = []
    let entitySum = 0
    let entityFrames = 0
    let entityMax = 0
    let sampleIndex = 0
    let accumulatedMs = 0
    const wallStart = performance.now()

    for (let index = 0; accumulatedMs < targetSeconds * 1000; index += 1) {
      const combatBefore = accumulatedMs
      const result = await playMatch(session, {
        playSelector: index === 0 ? undefined : `[data-testid="${PLAY_AGAIN}"]`,
        budgetMs: targetSeconds * 1000 - accumulatedMs,
      })
      const snap = await page.evaluate((from) => window.__prof.snapshot(from), sampleIndex)
      sampleIndex = snap.total
      allDt.push(...snap.dt)
      accumulatedMs += snap.dt.reduce((a, b) => a + b, 0)
      heapSeries.push(...result.heapSeries.map(([t, v]) => [round(combatBefore / 1000 + t, 1), v]))

      const game = result.gameSampler
      if (game?.frames) gameDt.push(...game.frames)
      if (game?.summary) {
        entitySum += game.summary.avgEntities * game.summary.frames
        entityFrames += game.summary.frames
        entityMax = Math.max(entityMax, game.summary.maxEntities)
      }
      const stats = frameStats(snap.dt)
      matches.push({
        match: index + 1,
        endedBy: result.endedBy,
        wallSeconds: result.wallSeconds,
        loadMs: result.loadMs,
        score: result.final.score,
        remainingClock: result.final.time,
        frames: stats.frames,
        avgFps: stats.avgFps,
        p95FrameMs: stats.p95FrameMs,
        p99FrameMs: stats.p99FrameMs,
        maxFrameMs: stats.maxFrameMs,
        maxEntities: game?.summary.maxEntities ?? null,
        avgEntities: game ? round(game.summary.avgEntities, 1) : null,
        gameSampler: game?.summary
          ? {
              frames: game.summary.frames,
              avgFps: round(game.summary.avgFps, 1),
              p95FrameMs: round(game.summary.p95FrameMs, 2),
              p99FrameMs: round(game.summary.p99FrameMs, 2),
              maxFrameMs: round(game.summary.maxFrameMs, 2),
            }
          : null,
      })
      log(
        `  [${id}] match ${index + 1}: ${result.endedBy} after ${result.wallSeconds}s, score ${result.final.score}, ` +
          `${stats.frames} frames, ${stats.avgFps} fps, p95 ${stats.p95FrameMs} ms, maxEnt ${game?.summary.maxEntities} ` +
          `| total combat ${round(accumulatedMs / 1000, 1)}s`,
      )
      if (result.endedBy === 'budget') break
    }
    const wallSeconds = round((performance.now() - wallStart) / 1000, 1)

    // ---- end-of-run measurements ----------------------------------------------------------
    const afterCombat = pick(await perfMetrics(cdp))
    const processesAfter = await processStats(browserCdp)
    await forceGc(cdp)
    const afterGc = pick(await perfMetrics(cdp))
    const longtasks = await page.evaluate(() => window.__prof.longtasks)
    const glAndAudio = await page.evaluate(() => ({
      glCreated: window.__prof.gl.created,
      glAlive: window.__prof.glAlive(),
      audioContexts: window.__prof.audio.contexts,
      audioContextsAlive: window.__prof.audioContextsAlive(),
      audioSources: window.__prof.audio.sources,
      audioSourcesEnded: window.__prof.audio.ended,
    }))
    const cpu = cpuMonitor.stop()

    const combatSeconds = accumulatedMs / 1000
    const cpuBusySeconds = afterCombat.TaskDuration - before.TaskDuration
    const cpuScript = afterCombat.ScriptDuration - before.ScriptDuration
    const stats = frameStats(allDt)
    const counters = {
      taskDurationSec: round(cpuBusySeconds, 2),
      scriptDurationSec: round(cpuScript, 2),
      layoutDurationSec: round(afterCombat.LayoutDuration - before.LayoutDuration, 3),
      recalcStyleDurationSec: round(
        afterCombat.RecalcStyleDuration - before.RecalcStyleDuration,
        3,
      ),
      wallSecondsBetweenReadings: round(afterCombat.Timestamp - before.Timestamp, 1),
      // Main-thread busy time per rendered combat frame (includes menus/loading between matches).
      mainThreadBusyMsPerFrame: round((cpuBusySeconds * 1000) / Math.max(1, allDt.length), 3),
      mainThreadUtilisationPct: round(
        (cpuBusySeconds / Math.max(0.001, afterCombat.Timestamp - before.Timestamp)) * 100,
        1,
      ),
    }
    const cpuTimes = (p) => (p ? round(p.cpuTime, 2) : null)
    const wallBetween = afterCombat.Timestamp - before.Timestamp
    const processCpu = {
      rendererCpuPctOfOneCore:
        processesAfter.renderer && processesBefore.renderer
          ? round(
              ((processesAfter.renderer.cpuTime - processesBefore.renderer.cpuTime) / wallBetween) *
                100,
              1,
            )
          : null,
      gpuProcessCpuPctOfOneCore:
        processesAfter.gpu && processesBefore.gpu
          ? round(
              ((processesAfter.gpu.cpuTime - processesBefore.gpu.cpuTime) / wallBetween) * 100,
              1,
            )
          : null,
      rendererCpuSec: cpuTimes(processesAfter.renderer),
    }

    const result = {
      id,
      label,
      generatedAt: new Date().toISOString(),
      config: {
        browser: launched.browser,
        browserVersion: instance.version(),
        headless: launched.headless,
        launchNotes: launched.notes,
        launchArgs: launched.args,
        uncapped,
        viewport,
        deviceScaleFactor: dpr,
        mobileEmulation: mobile,
        cpuThrottle,
        match: {
          sessionSeconds,
          spawnIntervalMs: Math.round(spawnSeconds * 1000),
          optionsShownInUi: options,
        },
        bot: 'hold W + Space + Q + E, alternate D/A every 3 s, real-time keyboard events',
        targetCombatSeconds: targetSeconds,
        productionBuild: true,
      },
      renderer: { webgl, gpu, idleRafHz: refreshHz },
      summary: {
        combatSeconds: round(combatSeconds, 1),
        matches: matches.length,
        wallSeconds,
        ...stats,
        maxEntities: entityMax,
        avgEntities: round(entityFrames ? entitySum / entityFrames : 0, 1),
        meetsSixtyFpsTarget: stats.avgFps >= 60 && stats.p95FrameMs <= 1000 / 60,
        gameSampler: gameDt.length ? frameStats(gameDt) : null,
      },
      matches,
      windows10s: windowed(allDt, 10),
      cpu: { ...counters, ...processCpu, systemCpu: cpu },
      longTasks: {
        count: longtasks.length,
        totalMs: longtasks.reduce((a, [, d]) => a + d, 0),
        maxMs: Math.max(0, ...longtasks.map(([, d]) => d)),
        entries: longtasks.slice(0, 100),
      },
      heap: {
        startMB: mb(before.JSHeapUsedSize),
        endMB: mb(afterCombat.JSHeapUsedSize),
        endAfterGcMB: mb(afterGc.JSHeapUsedSize),
        seriesMB: heapSeries,
        maxSampledMB: Math.max(...heapSeries.map(([, v]) => v), 0),
        avgSampledMB: round(mean(heapSeries.map(([, v]) => v)), 2),
      },
      processes: {
        before: processesBefore.processes,
        after: processesAfter.processes,
      },
      resources: glAndAudio,
      metricsBefore: before,
      metricsAfter: afterCombat,
      rawFrameMs: allDt.map((v) => round(v, 2)),
    }
    await session.context.close()
    await browserCdp.detach().catch(() => undefined)
    return result
  } finally {
    cpuMonitor.stop()
    await instance.close().catch(() => undefined)
  }
}
