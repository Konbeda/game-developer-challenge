import {
  forceGc,
  launchBrowser,
  listenerCounts,
  newSession,
  perfMetrics,
  processStats,
} from '../lib/browser.mjs'
import { openApp, readState, selectors, sleep } from '../lib/game.mjs'
import { playMatch } from '../lib/play.mjs'
import { round, slope } from '../lib/stats.mjs'

const { t } = selectors
const mb = (bytes) => round(bytes / 1024 / 1024, 2)

/** Everything worth comparing between cycles, read after a forced GC while the app sits on the menu. */
async function measure(session, browserCdp) {
  const { page, cdp } = session
  await forceGc(cdp)
  const metrics = await perfMetrics(cdp)
  const processes = await processStats(browserCdp)
  const inPage = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    domNodes: document.getElementsByTagName('*').length,
    glCreated: window.__prof.gl.created,
    glAlive: window.__prof.glAlive(),
    audioContexts: window.__prof.audio.contexts,
    audioContextsAlive: window.__prof.audioContextsAlive(),
    audioSources: window.__prof.audio.sources,
    audioSourcesEnded: window.__prof.audio.ended,
  }))
  const listeners = await listenerCounts(cdp)
  return {
    jsHeapMB: mb(metrics.JSHeapUsedSize),
    jsHeapTotalMB: mb(metrics.JSHeapTotalSize),
    nodes: metrics.Nodes,
    jsEventListeners: metrics.JSEventListeners,
    ...inPage,
    windowListeners: listeners.window?.total ?? null,
    documentListeners: listeners.document?.total ?? null,
    rendererWorkingSetMB: processes.renderer?.workingSetMB ?? null,
    rendererPrivateMB: processes.renderer?.privateMB ?? null,
    gpuProcessWorkingSetMB: processes.gpu?.workingSetMB ?? null,
    gpuProcessPrivateMB: processes.gpu?.privateMB ?? null,
  }
}

/**
 * README section 9: memory after five cycles of start -> play -> leave. Each cycle plays
 * `cycleSeconds` of real time with the keyboard bot (or until the bot dies), returns to the menu,
 * forces GC and measures. Cycle 0 is the fresh menu; cycle 1 pays one-off costs (textures, sounds,
 * JIT), so growth is judged from cycle 1 onwards.
 */
export async function runMemory({ browser, headless, cycles = 5, cycleSeconds = 20 }, url, log) {
  const launched = await launchBrowser({ browser, headless })
  const { instance } = launched
  try {
    const session = await newSession(instance, { viewport: { width: 1280, height: 720 } })
    const { page } = session
    const browserCdp = await instance.newBrowserCDPSession()
    await openApp(page, url)

    const rows = [{ cycle: 0, phase: 'fresh menu', ...(await measure(session, browserCdp)) }]
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const played = await playMatch(session, { playMs: cycleSeconds * 1000 })
      const state = await readState(page)
      if (state.screen === 'result') {
        await page.click(t('result-main-menu'))
        await page.locator(t('screen-menu')).first().waitFor()
      }
      await sleep(600)
      const row = await measure(session, browserCdp)
      rows.push({ cycle, endedBy: played.endedBy, playedSeconds: played.wallSeconds, ...row })
      log(
        `  [memory] cycle ${cycle}: ${played.endedBy} after ${played.wallSeconds}s | heap ${row.jsHeapMB} MB, nodes ${row.nodes}, ` +
          `listeners ${row.jsEventListeners}, canvases ${row.canvases}, GL alive ${row.glAlive}/${row.glCreated}, ` +
          `audio ctx alive ${row.audioContextsAlive}/${row.audioContexts}, renderer ${row.rendererPrivateMB} MB, GPU proc ${row.gpuProcessPrivateMB} MB`,
      )
    }

    const steady = rows.filter((r) => r.cycle >= 1)
    const xs = steady.map((r) => r.cycle)
    const series = (key) => steady.map((r) => r[key])
    const growth = (key) => ({
      first: steady[0]?.[key] ?? null,
      last: steady.at(-1)?.[key] ?? null,
      delta: steady.length > 1 ? round(steady.at(-1)[key] - steady[0][key], 2) : 0,
      slopePerCycle: round(slope(xs, series(key)), 3),
    })
    const summary = {
      cyclesMeasured: steady.length,
      jsHeapMB: growth('jsHeapMB'),
      domNodes: growth('domNodes'),
      jsEventListeners: growth('jsEventListeners'),
      windowListeners: growth('windowListeners'),
      documentListeners: growth('documentListeners'),
      canvasesAtMenu: series('canvases'),
      webglContexts: { createdPerCycle: series('glCreated'), alivePerCycle: series('glAlive') },
      audioContexts: {
        createdPerCycle: series('audioContexts'),
        alivePerCycle: series('audioContextsAlive'),
      },
      rendererPrivateMB: growth('rendererPrivateMB'),
      gpuProcessPrivateMB: growth('gpuProcessPrivateMB'),
    }
    const leaks = []
    if (summary.jsHeapMB.slopePerCycle > 1)
      leaks.push(`JS heap grows ${summary.jsHeapMB.slopePerCycle} MB per cycle`)
    if (summary.domNodes.delta > 10) leaks.push(`DOM nodes grew by ${summary.domNodes.delta}`)
    // Listener counts wobble by a couple between cycles (timers, GC); a trend is what matters.
    if (summary.jsEventListeners.slopePerCycle > 2)
      leaks.push(
        `JS event listeners trend up by ${summary.jsEventListeners.slopePerCycle} per cycle`,
      )
    if (summary.canvasesAtMenu.some((n) => n !== 0))
      leaks.push('a canvas survived leaving the match')
    // One context stays alive by design (Pixi caches its capability-probe canvas); only growth is a leak.
    if ((steady.at(-1)?.glAlive ?? 0) > (steady[0]?.glAlive ?? 0))
      leaks.push('WebGL contexts accumulate across cycles')
    if (steady.some((r) => r.audioContextsAlive > 1)) leaks.push('more than one AudioContext alive')
    const verdict =
      leaks.length === 0 ? 'no continuous growth detected' : `possible leaks: ${leaks.join('; ')}`

    await session.context.close()
    await browserCdp.detach().catch(() => undefined)
    return {
      generatedAt: new Date().toISOString(),
      config: {
        browser: launched.browser,
        browserVersion: instance.version(),
        headless: launched.headless,
        viewport: { width: 1280, height: 720 },
        cycles,
        cycleSeconds,
        match: 'default options (90 s session, 3 s spawn interval)',
        bot: 'hold W + Space + Q + E, alternate D/A every 3 s, real-time keyboard events',
        productionBuild: true,
      },
      summary,
      verdict,
      rows,
    }
  } finally {
    await instance.close().catch(() => undefined)
  }
}
