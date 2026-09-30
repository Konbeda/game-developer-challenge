import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

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
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
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
    command: `pnpm build:e2e && pnpm preview:e2e`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
