import { z } from 'zod'

/**
 * Test/demo controls read from the page URL. Every value is validated and bounded; anything
 * invalid is ignored (never trusted):
 *
 *   ?latencyMs=<0..5000>     fixed mock latency for every scenario (0 in tests)
 *   ?mockSeed=<uint32>       seed of the variable-latency PRNG
 *   ?retry=<0..3>            number of automatic GET retries in the client
 *   ?timeoutMs=<50..30000>   client request timeout (useful to shorten the timeout scenarios)
 */
export interface RuntimeOptions {
  latencyMs: number | null
  mockSeed: number | null
  retry: number | null
  timeoutMs: number | null
}

const digits = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))

const SCHEMAS = {
  latencyMs: digits(0, 5_000),
  mockSeed: digits(0, 0xffff_ffff),
  retry: digits(0, 3),
  timeoutMs: digits(50, 30_000),
} as const

const NONE: RuntimeOptions = { latencyMs: null, mockSeed: null, retry: null, timeoutMs: null }

function parseSearch(search: string): RuntimeOptions {
  const params = new URLSearchParams(search)
  const read = (key: keyof RuntimeOptions): number | null => {
    const raw = params.get(key)
    if (raw === null) return null
    const parsed = SCHEMAS[key].safeParse(raw)
    return parsed.success ? parsed.data : null
  }
  return {
    latencyMs: read('latencyMs'),
    mockSeed: read('mockSeed'),
    retry: read('retry'),
    timeoutMs: read('timeoutMs'),
  }
}

let cachedSearch: string | null = null
let cached: RuntimeOptions = NONE
let override: Partial<RuntimeOptions> = {}

/** Current options: programmatic override (tests) wins over the URL query. */
export function getRuntimeOptions(): RuntimeOptions {
  const search = typeof window === 'undefined' ? '' : window.location.search
  if (search !== cachedSearch) {
    cachedSearch = search
    cached = search ? parseSearch(search) : NONE
  }
  return {
    latencyMs: override.latencyMs !== undefined ? override.latencyMs : cached.latencyMs,
    mockSeed: override.mockSeed !== undefined ? override.mockSeed : cached.mockSeed,
    retry: override.retry !== undefined ? override.retry : cached.retry,
    timeoutMs: override.timeoutMs !== undefined ? override.timeoutMs : cached.timeoutMs,
  }
}

/**
 * Programmatic override for tests and tools (values are still range-checked). Pass `null` to clear
 * every override.
 */
export function setRuntimeOptions(next: Partial<RuntimeOptions> | null): void {
  if (next === null) {
    override = {}
    return
  }
  const clean: Partial<RuntimeOptions> = {}
  for (const key of Object.keys(SCHEMAS) as (keyof RuntimeOptions)[]) {
    const value = next[key]
    if (value === undefined) continue
    if (value === null) {
      clean[key] = null
      continue
    }
    const parsed = SCHEMAS[key].safeParse(String(value))
    if (parsed.success) clean[key] = parsed.data
  }
  override = { ...override, ...clean }
}
