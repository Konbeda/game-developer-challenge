import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Makes sure the PRODUCTION bundle (`pnpm build`, no e2e flag) is being served on `port`.
 * If something already answers there (for example `vite preview` started by hand) it is reused
 * and left running; otherwise `vite preview` is started and `stop()` shuts it down again.
 */
export async function ensureServer(root, port) {
  const url = `http://localhost:${port}/`
  if (await reachable(url)) return { url, stop: async () => {}, started: false }

  if (!existsSync(resolve(root, 'dist', 'index.html'))) {
    throw new Error('dist/ not found: run `pnpm build` first (production build, no e2e flag).')
  }
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: root,
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  const stop = async () => {
    if (child.pid === undefined) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  }
  for (let i = 0; i < 60; i += 1) {
    if (await reachable(url)) return { url, stop, started: true }
    await new Promise((r) => setTimeout(r, 500))
  }
  await stop()
  throw new Error(`vite preview did not come up on ${url}`)
}
