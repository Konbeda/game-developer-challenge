import { gpuFeatureStatus, launchBrowser, newSession, webglInfo } from '../lib/browser.mjs'
import { leaveViaPause, openApp, selectors, startMatch } from '../lib/game.mjs'
import { round } from '../lib/stats.mjs'

const { t } = selectors

/** Cold start of the production build and the time to load the combat assets. */
export async function runLoad({ browser, headless }, url, log) {
  const launched = await launchBrowser({ browser, headless })
  const { instance } = launched
  try {
    const session = await newSession(instance, { viewport: { width: 1280, height: 720 } })
    const { page } = session
    const browserCdp = await instance.newBrowserCDPSession()

    const started = performance.now()
    await openApp(page, url)
    const menuVisibleWallMs = round(performance.now() - started, 0)

    const navigation = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const paints = Object.fromEntries(
        performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
      )
      const resources = performance.getEntriesByType('resource')
      const byType = {}
      for (const r of resources) {
        const type = r.initiatorType || 'other'
        byType[type] ??= { count: 0, transferKB: 0 }
        byType[type].count += 1
        byType[type].transferKB += (r.transferSize || 0) / 1024
      }
      for (const v of Object.values(byType)) v.transferKB = Math.round(v.transferKB)
      return {
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadEventMs: Math.round(nav.loadEventEnd),
        paints,
        resourceCount: resources.length,
        resourcesByType: byType,
      }
    })

    const coldMatch = await startMatch(page)
    await leaveViaPause(page)
    const warmMatch = await startMatch(page)
    await leaveViaPause(page)
    await page.locator(t('screen-menu')).first().waitFor()

    const webgl = await webglInfo(page)
    const gpu = await gpuFeatureStatus(browserCdp)
    log(
      `  [load] menu ${menuVisibleWallMs} ms, FCP ${navigation.paints['first-contentful-paint']} ms, combat assets cold ${coldMatch.loadMs} ms / warm ${warmMatch.loadMs} ms`,
    )
    await session.context.close()
    await browserCdp.detach().catch(() => undefined)
    return {
      generatedAt: new Date().toISOString(),
      config: {
        browser: launched.browser,
        browserVersion: instance.version(),
        headless: launched.headless,
        viewport: { width: 1280, height: 720 },
        cache: 'empty (fresh browser context)',
        latencyMs: 0,
        productionBuild: true,
      },
      renderer: { webgl, gpu },
      menu: { visibleFromNavigationStartWallMs: menuVisibleWallMs, ...navigation },
      combatAssets: {
        note: 'click on Play -> match running (includes loading every combat texture, creating the canvas and starting the simulation)',
        coldMs: coldMatch.loadMs,
        warmMs: warmMatch.loadMs,
      },
    }
  } finally {
    await instance.close().catch(() => undefined)
  }
}
