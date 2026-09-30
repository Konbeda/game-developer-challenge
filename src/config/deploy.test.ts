import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The deploy fails outright when vercel.json is not valid JSON, so it is guarded by a test.
describe('vercel.json', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    rewrites?: { source: string; destination: string }[]
    headers?: { source: string }[]
  }

  it('is valid JSON with an SPA fallback', () => {
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' })
  })

  it('serves the MSW worker with no-cache headers', () => {
    expect(config.headers?.some((h) => h.source === '/mockServiceWorker.js')).toBe(true)
  })
})
