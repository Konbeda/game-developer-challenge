import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { powershellJson } from './env.mjs'
import { sleep } from './game.mjs'

const INPAGE = fileURLToPath(new URL('./inpage.js', import.meta.url))

/**
 * Browser choices. `chrome` = the installed Google Chrome driven through Playwright's
 * `channel: 'chrome'` (real GPU through ANGLE/D3D11). `chromium` = Playwright's own bundled
 * Chromium; its headless shell only offers software (SwiftShader) WebGL.
 */
export async function launchBrowser({ browser = 'chrome', headless = false, uncapped = false }) {
  const args = ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--mute-audio']
  if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit')
  const base = { args, ...(browser === 'chrome' ? { channel: 'chrome' } : {}) }

  const notes = []
  if (!headless) {
    try {
      const instance = await chromium.launch({ ...base, headless: false })
      return { instance, headless: false, notes, args, browser }
    } catch (error) {
      notes.push(`headed launch of "${browser}" failed: ${String(error.message).split('\n')[0]}`)
    }
  }
  const instance = await chromium.launch({ ...base, headless: true })
  return { instance, headless: true, notes, args, browser }
}

/** New isolated context + page with the in-page instrumentation and a CDP session. */
export async function newSession(instance, { viewport, dpr = 1, mobile = false, cpuThrottle = 1 }) {
  const context = await instance.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'allow',
    locale: 'en-US',
  })
  await context.addInitScript({ path: INPAGE })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')
  if (cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle })
  return { context, page, cdp }
}

export async function forceGc(cdp) {
  for (let i = 0; i < 3; i += 1) {
    await cdp.send('HeapProfiler.collectGarbage')
    await sleep(120)
  }
}

export async function perfMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}

/** Event listeners registered on window / document / <html> / <body>, counted by type. */
export async function listenerCounts(cdp) {
  const out = {}
  for (const target of ['window', 'document', 'document.documentElement', 'document.body']) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: target })
    if (!result.objectId) continue
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    })
    const byType = {}
    for (const listener of listeners) byType[listener.type] = (byType[listener.type] ?? 0) + 1
    out[target] = { total: listeners.length, byType }
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId })
  }
  return out
}

/**
 * Working set / private bytes of the browser's renderer and GPU processes (Windows), through the
 * browser-level CDP `SystemInfo.getProcessInfo` (pid + cpu time) and Get-Process (memory).
 */
export async function processStats(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo')
  const result = { processes: processInfo }
  if (process.platform === 'win32') {
    const ids = processInfo.map((p) => p.id).join(',')
    const rows = powershellJson(
      `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64`,
    )
    const list = Array.isArray(rows) ? rows : rows ? [rows] : []
    const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10
    result.processes = processInfo.map((p) => {
      const row = list.find((r) => r.Id === p.id)
      return {
        ...p,
        workingSetMB: row ? mb(row.WorkingSet64) : null,
        privateMB: row ? mb(row.PrivateMemorySize64) : null,
      }
    })
  }
  // The page under test lives in the busiest renderer.
  const renderers = result.processes.filter((p) => p.type === 'renderer')
  result.renderer = [...renderers].sort((a, b) => b.cpuTime - a.cpuTime)[0] ?? null
  result.gpu = result.processes.find((p) => p.type === 'GPU') ?? null
  return result
}

/** WebGL renderer string of the context Chrome really uses (proves GPU vs SwiftShader). */
export function webglInfo(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return null
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      userAgent: navigator.userAgent,
    }
  })
}

export async function gpuFeatureStatus(browserCdp) {
  const info = await browserCdp.send('SystemInfo.getInfo')
  const status = info.gpu.featureStatus ?? {}
  return {
    glImplementation: info.gpu.auxAttributes?.glImplementationParts ?? null,
    devices: info.gpu.devices.map((d) => `${d.deviceString} (driver ${d.driverVersion || 'n/a'})`),
    webgl: status.webgl,
    gpuCompositing: status.gpu_compositing,
    rasterization: status.rasterization,
  }
}
