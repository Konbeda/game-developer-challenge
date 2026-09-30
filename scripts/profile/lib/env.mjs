import { execFile, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

export function powershellJson(script) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `${script} | ConvertTo-Json -Compress -Depth 4`],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0 || !result.stdout.trim()) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : [])

/** Hardware / OS description of the machine running the profile (never invented: read from the OS). */
export function collectMachine() {
  const machine = {
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
    totalMemoryGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    cpuModelNode: os.cpus()[0]?.model ?? null,
    logicalCpus: os.cpus().length,
  }
  if (process.platform !== 'win32') return machine

  const cpu = powershellJson(
    'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed',
  )
  const gpu = powershellJson(
    'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate',
  )
  const system = powershellJson(
    'Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory',
  )
  const osInfo = powershellJson(
    'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber',
  )
  const memory = powershellJson(
    'Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed,ConfiguredClockSpeed',
  )
  const cpuInfo = asArray(cpu)[0]
  return {
    ...machine,
    cpu: cpuInfo
      ? {
          name: cpuInfo.Name?.trim(),
          cores: cpuInfo.NumberOfCores,
          logicalProcessors: cpuInfo.NumberOfLogicalProcessors,
          baseMHz: cpuInfo.MaxClockSpeed,
        }
      : null,
    gpus: asArray(gpu).map((g) => ({
      name: g.Name,
      driver: g.DriverVersion,
      resolution:
        g.CurrentHorizontalResolution && g.CurrentVerticalResolution
          ? `${g.CurrentHorizontalResolution}x${g.CurrentVerticalResolution}`
          : null,
      refreshHz: g.CurrentRefreshRate ?? null,
    })),
    system: asArray(system)[0] ?? null,
    os: asArray(osInfo)[0] ?? null,
    memoryModules: asArray(memory).map((m) => ({
      gib: Math.round(m.Capacity / 1024 ** 3),
      mtPerSec: m.ConfiguredClockSpeed ?? m.Speed,
    })),
  }
}

export function collectGit(root) {
  const run = (args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim()
  return { commit: run(['rev-parse', 'HEAD']), branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) }
}

/** Whole-machine CPU utilisation sampled from os.cpus() deltas (evidence of background contention). */
export function startCpuMonitor(intervalMs = 1000) {
  const snapshot = () =>
    os.cpus().reduce(
      (acc, cpu) => {
        const t = cpu.times
        acc.idle += t.idle
        acc.total += t.user + t.nice + t.sys + t.irq + t.idle
        return acc
      },
      { idle: 0, total: 0 },
    )
  let prev = snapshot()
  const samples = []
  const timer = setInterval(() => {
    const now = snapshot()
    const total = now.total - prev.total
    if (total > 0) samples.push(100 * (1 - (now.idle - prev.idle) / total))
    prev = now
  }, intervalMs)
  return {
    stop() {
      clearInterval(timer)
      const sorted = [...samples].sort((a, b) => a - b)
      const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1)
      return {
        samples: samples.length,
        avgPct: Math.round(avg * 10) / 10,
        p95Pct:
          Math.round((sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0) * 10) / 10,
        maxPct: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
      }
    },
  }
}

/**
 * System-wide NVIDIA GPU utilisation / memory / graphics clock via nvidia-smi (if present).
 * It is whole-GPU (desktop, other apps and the browser), so it is context for the run, not
 * an attribution to the game alone.
 */
export function startGpuMonitor(intervalMs = 2000) {
  const samples = []
  let running = true
  let busy = false
  const query = () =>
    new Promise((resolve) => {
      execFile(
        'nvidia-smi',
        ['--query-gpu=utilization.gpu,memory.used,clocks.gr', '--format=csv,noheader,nounits'],
        { windowsHide: true, timeout: 4000 },
        (error, stdout) => {
          if (error) return resolve(null)
          const [util, mem, clock] = stdout
            .trim()
            .split(',')
            .map((v) => Number(v.trim()))
          resolve(Number.isFinite(util) ? { util, mem, clock } : null)
        },
      )
    })
  const timer = setInterval(async () => {
    if (!running || busy) return
    busy = true
    const sample = await query()
    busy = false
    if (sample && running) samples.push(sample)
  }, intervalMs)
  const stat = (key) => {
    const values = samples.map((s) => s[key])
    return values.length
      ? {
          avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
          max: Math.max(...values),
          min: Math.min(...values),
        }
      : null
  }
  return {
    async baseline() {
      return query()
    },
    stop() {
      running = false
      clearInterval(timer)
      return samples.length
        ? {
            samples: samples.length,
            utilPct: stat('util'),
            memoryMiB: stat('mem'),
            clockMHz: stat('clock'),
          }
        : null
    },
  }
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** Sizes of the production build: raw and gzip for JS/CSS/fonts, raw for the game assets. */
export function measureBuild(root) {
  const dist = join(root, 'dist')
  const bundle = walk(join(dist, 'bundle')).map((file) => {
    const raw = readFileSync(file)
    const compressible = /\.(js|css)$/.test(file)
    return {
      file: relative(dist, file).replaceAll('\\', '/'),
      bytes: raw.length,
      gzipBytes: compressible ? gzipSync(raw).length : null,
    }
  })
  const sum = (items, key) => items.reduce((total, item) => total + (item[key] ?? 0), 0)
  const js = bundle.filter((f) => f.file.endsWith('.js'))
  const css = bundle.filter((f) => f.file.endsWith('.css'))
  const index = readFileSync(join(dist, 'index.html'), 'utf8')
  const gameAssets = walk(join(dist, 'assets'))
  const bySub = (prefix) =>
    gameAssets
      .filter((f) => relative(join(dist, 'assets'), f).replaceAll('\\', '/').startsWith(prefix))
      .reduce((total, f) => total + statSync(f).size, 0)
  return {
    jsFiles: js.length,
    jsBytes: sum(js, 'bytes'),
    jsGzipBytes: sum(js, 'gzipBytes'),
    cssBytes: sum(css, 'bytes'),
    cssGzipBytes: sum(css, 'gzipBytes'),
    indexHtmlBytes: index.length,
    largestJs: [...js].sort((a, b) => b.bytes - a.bytes).slice(0, 3),
    modulePreloads: (index.match(/<link rel="modulepreload"/g) ?? []).length,
    assetsFolderBytes: gameAssets.reduce((total, f) => total + statSync(f).size, 0),
    assetsPngDefaultBytes: bySub('png/default'),
    assetsSoundsBytes: bySub('sounds'),
    files: bundle,
  }
}
