import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/nunito-sans/latin-400.css'
import '@fontsource/nunito-sans/latin-600.css'
import '@fontsource/nunito-sans/latin-700.css'
import './index.css'
import App from './App.tsx'
import { flushPending } from './api/outbox.ts'
import { AppQueryProvider } from './api/QueryProvider.tsx'
import { initSentry } from './lib/sentry.ts'
import { enableMocking } from './mocks/index.ts'
import { CrashScreen } from './ui/CrashScreen.tsx'
import { applySkin, whenSkinReady } from './ui/skin.ts'

/** How long the app waits for the mock service worker before starting anyway. */
const MOCKING_TIMEOUT_MS = 3_000

async function boot(): Promise<void> {
  initSentry()
  void applySkin()

  // A mock that fails or hangs must never keep the game from opening.
  await Promise.race([
    enableMocking().catch((error: unknown) => console.error('Mock API failed to start', error)),
    new Promise<void>((resolve) => setTimeout(resolve, MOCKING_TIMEOUT_MS)),
  ])

  // Avoid a flash of unskinned buttons on a cold load, but never wait long.
  await whenSkinReady(1_500)

  // Send anything a previous session left in the outbox (pending or failed submissions).
  try {
    flushPending()
  } catch (error) {
    console.error('Could not flush pending matches', error)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Sentry.ErrorBoundary fallback={({ resetError }) => <CrashScreen onRetry={resetError} />}>
        <AppQueryProvider>
          <App />
        </AppQueryProvider>
      </Sentry.ErrorBoundary>
    </StrictMode>,
  )
}

void boot()
