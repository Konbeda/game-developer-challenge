import { launchBrowser, newSession } from '../lib/browser.mjs'
import { KeyBot, leaveViaPause, openApp, readState, sleep, startMatch } from '../lib/game.mjs'
import { round } from '../lib/stats.mjs'

const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'v8',
  'v8.gc',
  'gpu',
  'toplevel',
]
const TRACE_SECONDS = 20

/** Short Chrome trace of real combat, reduced to long tasks, GC and GPU-process busy time. */
export async function runTrace({ browser, headless }, url, log) {
  const launched = await launchBrowser({ browser, headless })
  const { instance } = launched
  try {
    const session = await newSession(instance, { viewport: { width: 1280, height: 720 } })
    const { page } = session
    await openApp(page, url)

    await instance.startTracing(page, { categories: CATEGORIES })
    await startMatch(page)
    const bot = new KeyBot(page, { turnMs: 3000 })
    const t0 = performance.now()
    while (performance.now() - t0 < TRACE_SECONDS * 1000) {
      await bot.tick(performance.now() - t0)
      const state = await readState(page)
      if (state.phase !== 'running') break
      await sleep(100)
    }
    await bot.releaseAll()
    const buffer = await instance.stopTracing()
    const tracedSeconds = round((performance.now() - t0) / 1000, 1)
    if ((await readState(page)).phase === 'running') await leaveViaPause(page)

    const events = JSON.parse(buffer.toString('utf8')).traceEvents
    const threads = new Map()
    for (const e of events) {
      if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name)
    }
    const nameOf = (e) => threads.get(`${e.pid}:${e.tid}`) ?? ''
    const summarise = (filter) => {
      const list = events.filter((e) => e.ph === 'X' && filter(e)).map((e) => e.dur / 1000)
      return {
        count: list.length,
        totalMs: round(
          list.reduce((a, b) => a + b, 0),
          1,
        ),
        maxMs: round(Math.max(0, ...list), 2),
        over16msCount: list.filter((d) => d > 16.7).length,
        over50msCount: list.filter((d) => d > 50).length,
      }
    }
    const rendererMain = summarise((e) => e.name === 'RunTask' && nameOf(e) === 'CrRendererMain')
    const gpuMain = summarise((e) => e.name === 'RunTask' && /Gpu/i.test(nameOf(e)))
    const minorGc = summarise((e) => e.name === 'MinorGC' || e.name === 'V8.GCScavenger')
    const majorGc = summarise((e) => e.name === 'MajorGC' || e.name === 'V8.GCCompactor')
    log(
      `  [trace] ${tracedSeconds}s traced: renderer main ${rendererMain.count} tasks (${rendererMain.over50msCount} >50 ms), minor GC ${minorGc.count} (max ${minorGc.maxMs} ms), major GC ${majorGc.count}`,
    )

    await session.context.close()
    return {
      generatedAt: new Date().toISOString(),
      config: {
        browser: launched.browser,
        browserVersion: instance.version(),
        headless: launched.headless,
        categories: CATEGORIES,
        tracedSeconds,
        productionBuild: true,
      },
      threadsSeen: [...new Set(threads.values())].slice(0, 40),
      rendererMainThread: {
        busyPctOfWindow: round((rendererMain.totalMs / (tracedSeconds * 1000)) * 100, 1),
        ...rendererMain,
      },
      gpuThread: {
        busyPctOfWindow: round((gpuMain.totalMs / (tracedSeconds * 1000)) * 100, 1),
        ...gpuMain,
      },
      gc: { minor: minorGc, major: majorGc },
      note: 'Only aggregates are stored; the raw trace is several tens of MB.',
    }
  } finally {
    await instance.close().catch(() => undefined)
  }
}
