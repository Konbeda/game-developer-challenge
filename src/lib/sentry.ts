import * as Sentry from '@sentry/react'

/**
 * Error monitoring is opt-in: without VITE_SENTRY_DSN this is a no-op, so a
 * clean checkout never depends on a private service.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,
    tracesSampleRate: 0,
  })
}
