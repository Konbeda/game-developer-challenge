import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatDuration,
  formatPlayed,
  formatRank,
  spokenDuration,
} from './format.ts'

describe('format', () => {
  it('formats durations as mm:ss (rounding down)', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(102_000)).toBe('01:42')
    expect(formatDuration(119_999)).toBe('01:59')
    expect(formatDuration(600_000)).toBe('10:00')
  })

  it('counts down rounding up, never below zero', () => {
    expect(formatCountdown(90_000)).toBe('01:30')
    expect(formatCountdown(89_001)).toBe('01:30')
    expect(formatCountdown(1)).toBe('00:01')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(-50)).toBe('00:00')
  })

  it('formats the played date', () => {
    expect(formatPlayed('2026-09-08T21:42:10.000Z', 'UTC')).toBe('08 SEP · 21:42')
    expect(formatPlayed('not a date')).toBe('--')
  })

  it('pads ranks', () => {
    expect(formatRank(3)).toBe('03')
    expect(formatRank(12)).toBe('12')
  })

  it('speaks durations', () => {
    expect(spokenDuration(102_000)).toBe('1 minute 42 seconds')
    expect(spokenDuration(30_000)).toBe('30 seconds')
    expect(spokenDuration(120_000)).toBe('2 minutes')
    expect(spokenDuration(0)).toBe('0 seconds')
  })
})
