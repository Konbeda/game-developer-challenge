/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
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
  },
})
