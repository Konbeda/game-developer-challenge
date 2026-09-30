import { describe, expect, it } from 'vitest'
import { createRng } from './rng.ts'

describe('mulberry32 rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next())
  })

  it('matches the reference mulberry32 values (regression guard)', () => {
    const rng = createRng(1)
    // Reference values of mulberry32 with seed 1.
    expect(rng.next()).toBeCloseTo(0.6270739405881613, 12)
    expect(rng.next()).toBeCloseTo(0.002735721180215478, 12)
    expect(rng.next()).toBeCloseTo(0.5274470399599522, 12)
  })

  it('gives different sequences for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const same = Array.from({ length: 20 }, () => a.next() === b.next()).filter(Boolean)
    expect(same.length).toBe(0)
  })

  it('stays inside [0, 1) and is roughly uniform', () => {
    const rng = createRng(99)
    const buckets = new Array<number>(10).fill(0)
    const n = 20_000
    for (let i = 0; i < n; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      buckets[Math.floor(v * 10)] = (buckets[Math.floor(v * 10)] ?? 0) + 1
    }
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(n * 0.02)
  })

  it('int() and range() respect their bounds', () => {
    const rng = createRng(7)
    for (let i = 0; i < 2000; i++) {
      const k = rng.int(5)
      expect(Number.isInteger(k) && k >= 0 && k < 5).toBe(true)
      const r = rng.range(-3, 4)
      expect(r).toBeGreaterThanOrEqual(-3)
      expect(r).toBeLessThan(4)
    }
  })

  it('shuffle keeps the same elements and is deterministic', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = [...items]
    const b = [...items]
    createRng(5).shuffle(a)
    createRng(5).shuffle(b)
    expect(a).toEqual(b)
    expect([...a].sort()).toEqual(items)
  })

  it('accepts the full uint32 seed range', () => {
    expect(() => createRng(0xffff_ffff).next()).not.toThrow()
    expect(createRng(0).next()).not.toBeNaN()
  })
})
