import { defineConfig, devices } from '@playwright/test'

// Parallel runs (or several worktrees) can pick their own port: E2E_PORT=4174 pnpm e2e
const PORT = Number(process.env.E2E_PORT ?? 4173)
// E2E_GPU=1 runs the installed Google Chrome, which uses the real GPU (much lighter on the CPU than the
// bundled headless Chromium, which renders WebGL in software). Leave it unset in CI and when updating
// visual baselines: software rendering is the reproducible reference.
const useGpu = process.env.E2E_GPU === '1'
const DIST = `dist-e2e-${PORT}`

/**
 * Tests run against an optimised build made in `e2e` mode (window.__game test hook on) served by
 * `vite preview`, so what they exercise is the production bundle including the MSW service worker.
 * Each test gets a fresh browser context, hence fresh localStorage/IndexedDB/service worker state.
 */
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Visual baselines were generated on Windows; font rendering differs on Linux runners, so CI skips the
  // pixel comparison unless E2E_VISUAL=1 (with baselines generated on that platform).
  ignoreSnapshots: !!process.env.CI && process.env.E2E_VISUAL !== '1',
  retries: process.env.CI ? 1 : 0,
  // The preview server aborts navigations under heavy parallel load; a few workers stay reliable.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  reporter: [['html', { open: 'never' }], ['list']],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    serviceWorkers: 'allow',
    ...(useGpu ? { channel: 'chrome' as const } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7 landscape'],
        // Touch layout: landscape phone.
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e --outDir ${DIST} && pnpm exec vite preview --outDir ${DIST} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Without this the build has no window.__game hook (the host only installs it when VITE_E2E is 'true').
    env: { VITE_E2E: 'true' },
  },
})
