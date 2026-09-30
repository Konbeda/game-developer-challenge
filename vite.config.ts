/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

/** Short commit of this build: Vercel provides it, locally it comes from git. Shown in the menu so anyone can tell which version they are running. */
function buildId(): string {
  const fromHost = process.env['VERCEL_GIT_COMMIT_SHA']
  if (fromHost) return fromHost.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  plugins: [
    react(),
    tailwindcss(),
    // Serve the provided assets/ folder at /assets in dev and copy it into dist on build.
    viteStaticCopy({
      targets: [{ src: 'assets', dest: '.' }],
      silent: true,
    }),
  ],
  // Keep Vite bundles out of /assets, which serves the provided game assets.
  build: { assetsDir: 'bundle' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
