import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)))
page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText))
page.on('request', (r) => console.log('REQ', r.url().slice(0, 100)))
const t = Date.now()
try {
  await page.goto('http://localhost:4173/?latencyMs=0&mockSeed=1&retry=0&clock=manual&seed=1', { timeout: 15000 })
  console.log('loaded', Date.now() - t)
} catch (e) {
  console.log('ERR', String(e).slice(0, 200))
}
await browser.close()
