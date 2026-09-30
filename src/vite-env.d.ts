/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_APP_VERSION?: string
  /** "true" enables window.__game (E2E instrumentation). Never set in the public build. */
  readonly VITE_E2E?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
