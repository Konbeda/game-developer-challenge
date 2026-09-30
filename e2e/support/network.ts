import type { Page } from '@playwright/test'

export interface ApiCall {
  method: string
  /** Path and query string, e.g. `/api/ranking?sessionSeconds=90&page=2`. */
  url: string
  path: string
  search: string
}

export interface ApiTracker {
  /** Every `/api/*` request the page issued so far (in order, including those MSW answers). */
  readonly calls: readonly ApiCall[]
  /** Number of calls by method and path prefix (e.g. `count('POST', '/api/matches')`). */
  count(method: string, pathPrefix: string): number
  /** Number of `/api/*` responses received so far by path prefix. */
  responses(pathPrefix: string): number
}

/**
 * Records the page's API traffic. MSW answers these requests inside the page's service worker,
 * but the page still issues them, so `page.on('request' | 'response')` sees every attempt.
 * Attach it right after `openApp` (before the interaction under test).
 */
export function trackApi(page: Page): ApiTracker {
  const calls: ApiCall[] = []
  const answered: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    calls.push({
      method: request.method(),
      url: url.pathname + url.search,
      path: url.pathname,
      search: url.search,
    })
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/')) answered.push(url.pathname)
  })
  return {
    calls,
    count: (method, pathPrefix) =>
      calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix)).length,
    responses: (pathPrefix) => answered.filter((p) => p.startsWith(pathPrefix)).length,
  }
}
