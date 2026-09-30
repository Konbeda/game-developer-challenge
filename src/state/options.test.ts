import { describe, expect, it } from 'vitest'
import { DEFAULT_MATCH_CONFIG } from '../contracts/match.ts'
import {
  canStepSession,
  canStepSpawn,
  configToDraft,
  formatSeconds,
  parseSessionSeconds,
  parseSpawnSeconds,
  stepSessionSeconds,
  stepSpawnSeconds,
  validateDraft,
} from './options.ts'

describe('parseSessionSeconds', () => {
  it('accepts whole seconds inside 60..180', () => {
    expect(parseSessionSeconds('60')).toEqual({ ok: true, value: 60 })
    expect(parseSessionSeconds(' 120 ')).toEqual({ ok: true, value: 120 })
    expect(parseSessionSeconds('180')).toEqual({ ok: true, value: 180 })
  })

  it.each(['', '59', '181', '-90', '90.5', 'abc', '1e2', '0x50', '９０'])('rejects %j', (raw) => {
    expect(parseSessionSeconds(raw).ok).toBe(false)
  })
})

describe('parseSpawnSeconds', () => {
  it('converts seconds with one decimal to milliseconds', () => {
    expect(parseSpawnSeconds('0.5')).toEqual({ ok: true, value: 500 })
    expect(parseSpawnSeconds('3')).toEqual({ ok: true, value: 3000 })
    expect(parseSpawnSeconds('2,5')).toEqual({ ok: true, value: 2500 })
    expect(parseSpawnSeconds('0.7')).toEqual({ ok: true, value: 700 })
    expect(parseSpawnSeconds('10')).toEqual({ ok: true, value: 10_000 })
  })

  it.each(['', '0', '0.4', '10.1', '11', '2.55', '-1', 'x', '1..2', '.5'])('rejects %j', (raw) => {
    expect(parseSpawnSeconds(raw).ok).toBe(false)
  })
})

describe('validateDraft', () => {
  it('returns a schema-valid config', () => {
    expect(validateDraft({ sessionSeconds: '75', spawnSeconds: '1.2' })).toEqual({
      ok: true,
      config: { sessionSeconds: 75, spawnIntervalMs: 1200 },
    })
  })

  it('reports an error per invalid field', () => {
    const result = validateDraft({ sessionSeconds: '5', spawnSeconds: 'fast' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.sessionSeconds).toBeTruthy()
      expect(result.errors.spawnSeconds).toBeTruthy()
    }
  })

  it('round-trips the default config through the drafts', () => {
    const result = validateDraft(configToDraft(DEFAULT_MATCH_CONFIG))
    expect(result).toEqual({ ok: true, config: DEFAULT_MATCH_CONFIG })
  })
})

describe('stepping', () => {
  it('steps session time by 5 s inside the limits', () => {
    expect(stepSessionSeconds('90', 1)).toBe('95')
    expect(stepSessionSeconds('178', 1)).toBe('180')
    expect(stepSessionSeconds('62', -1)).toBe('60')
    expect(canStepSession('180', 1)).toBe(false)
    expect(canStepSession('60', -1)).toBe(false)
    expect(canStepSession('90', 1)).toBe(true)
  })

  it('steps spawn time by 0.1 s without float noise', () => {
    expect(stepSpawnSeconds('0.5', 1)).toBe('0.6')
    expect(stepSpawnSeconds('0.7', 1)).toBe('0.8')
    expect(stepSpawnSeconds('2.9', 1)).toBe('3')
    expect(stepSpawnSeconds('0.5', -1)).toBe('0.5')
    expect(stepSpawnSeconds('10', 1)).toBe('10')
    expect(canStepSpawn('10', 1)).toBe(false)
    expect(canStepSpawn('0.5', -1)).toBe(false)
  })

  it('recovers from invalid text by stepping from the default', () => {
    expect(stepSessionSeconds('oops', 1)).toBe('95')
    expect(stepSpawnSeconds('', -1)).toBe('2.9')
  })
})

describe('formatSeconds', () => {
  it('shows whole and fractional seconds', () => {
    expect(formatSeconds(3000)).toBe('3')
    expect(formatSeconds(2500)).toBe('2.5')
    expect(formatSeconds(500)).toBe('0.5')
  })
})
