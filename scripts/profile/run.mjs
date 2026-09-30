#!/usr/bin/env node
/**
 * Performance profiling for Pirate Battle (README section 9).
 *
 *   pnpm build && pnpm profile                       # everything, default reference settings
 *   pnpm profile -- --suite combat                   # one suite (comma-separated list allowed)
 *   pnpm profile -- --suite memory --cycles 5 --cycle-seconds 20
 *
 * Runs against the PRODUCTION bundle (`pnpm build`, no e2e flag) served by `vite preview`. If
 * nothing answers on PROFILE_PORT (default 4175) the script starts `vite preview` itself and stops
 * it afterwards. Raw results are written to docs/perf-results/*.json.
 *
 * Suites: env, load, combat (reference), uncapped, software, mobile, trace, memory.
 * Real-time waiting is intentional (a 3-minute match takes 3 minutes): the production build has
 * no manual clock, so the only honest way to profile it is to play it in real time.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectGit, collectMachine, measureBuild } from './lib/env.mjs'
import { ensureServer } from './lib/server.mjs'
import { runCombat } from './suites/combat.mjs'
import { runLoad } from './suites/load.mjs'
import { runMemory } from './suites/memory.mjs'
import { runTrace } from './suites/trace.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      args._.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const PORT = Number(args.port ?? process.env.PROFILE_PORT ?? 4175)
const OUT = resolve(ROOT, args.out ?? 'docs/perf-results')
const MATCH_SECONDS = Number(args['match-seconds'] ?? 180)
const TARGET_SECONDS = Number(args['target-seconds'] ?? MATCH_SECONDS)
const CYCLES = Number(args.cycles ?? 5)
const CYCLE_SECONDS = Number(args['cycle-seconds'] ?? 20)
const BROWSER = args.browser ?? 'chrome'
const HEADLESS = Boolean(args.headless)
const ALL = ['env', 'load', 'combat', 'uncapped', 'software', 'mobile', 'trace', 'memory']
const requested = String(args.suite ?? 'all')
const suites = requested === 'all' ? ALL : requested.split(',').map((s) => s.trim())

const log = (message) => console.log(message)
const write = (name, data) => {
  mkdirSync(OUT, { recursive: true })
  const path = resolve(OUT, name)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
  log(`  wrote ${path.replace(ROOT, '.')}`)
}

const server = await ensureServer(ROOT, PORT)
const APP = `http://localhost:${PORT}/?perf=1&latencyMs=0`
log(
  `Profiling ${server.url} (${server.started ? 'started vite preview' : 'reusing running server'}), suites: ${suites.join(', ')}`,
)

let exitCode = 0
try {
  if (suites.includes('env')) {
    log('[env] collecting environment')
    write('environment.json', {
      generatedAt: new Date().toISOString(),
      git: collectGit(ROOT),
      machine: collectMachine(),
      build: measureBuild(ROOT),
    })
  }

  if (suites.includes('load')) {
    log('[load] cold start and combat asset loading')
    write('load.json', await runLoad({ browser: BROWSER, headless: HEADLESS }, server.url, log))
  }

  const combat = {
    combat: {
      id: 'reference',
      label: 'Reference: real GPU, 1920x1080 @1x, display vsync',
      file: 'combat-reference.json',
      headless: HEADLESS,
      viewport: { width: 1920, height: 1080 },
    },
    uncapped: {
      id: 'uncapped',
      label: 'Headroom: same as reference with vsync and frame-rate limit disabled',
      file: 'combat-uncapped.json',
      uncapped: true,
      headless: HEADLESS,
      viewport: { width: 1920, height: 1080 },
    },
    software: {
      id: 'software',
      label: 'Worst case: Playwright headless Chromium, software WebGL (SwiftShader), 1280x720',
      file: 'combat-software.json',
      browser: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 720 },
    },
  }
  const mobile = [
    { dpr: 2, file: 'combat-mobile-dpr2.json' },
    { dpr: 3, file: 'combat-mobile-dpr3.json' },
  ].map(({ dpr, file }) => ({
    id: `mobile-dpr${dpr}`,
    label: `Mobile-like: 812x375, DPR ${dpr}, 4x CPU throttle, touch UI, real GPU`,
    file,
    headless: HEADLESS,
    viewport: { width: 812, height: 375 },
    dpr,
    mobile: true,
    cpuThrottle: 4,
    targetSeconds: Number(args['mobile-seconds'] ?? 90),
  }))

  const plan = []
  for (const name of ['combat', 'uncapped', 'software']) {
    if (suites.includes(name)) plan.push(combat[name])
  }
  if (suites.includes('mobile')) plan.push(...mobile)

  for (const config of plan) {
    log(`[${config.id}] ${config.label}`)
    const { file, ...rest } = config
    const result = await runCombat(
      { browser: BROWSER, sessionSeconds: MATCH_SECONDS, targetSeconds: TARGET_SECONDS, ...rest },
      server.url + '?perf=1&latencyMs=0',
      log,
    )
    write(file, result)
    const s = result.summary
    log(
      `  => ${s.combatSeconds}s combat over ${s.matches} matches: ${s.avgFps} fps avg, p50 ${s.p50FrameMs} / p95 ${s.p95FrameMs} / p99 ${s.p99FrameMs} / max ${s.maxFrameMs} ms, entities max ${s.maxEntities} avg ${s.avgEntities}`,
    )
  }

  if (suites.includes('trace')) {
    log('[trace] short traced combat run (GC, long tasks, GPU tasks)')
    write(
      'trace-summary.json',
      await runTrace(
        { browser: BROWSER, headless: HEADLESS },
        server.url + '?perf=1&latencyMs=0',
        log,
      ),
    )
  }

  if (suites.includes('memory')) {
    log('[memory] five start -> play -> leave cycles')
    const memory = await runMemory(
      { browser: BROWSER, headless: HEADLESS, cycles: CYCLES, cycleSeconds: CYCLE_SECONDS },
      server.url + '?perf=1&latencyMs=0',
      log,
    )
    write(args['memory-file'] ?? 'memory.json', memory)
  }
  void APP
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  await server.stop()
}
process.exit(exitCode)
