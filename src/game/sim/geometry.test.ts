import { describe, expect, it } from 'vitest'
import { ARENA } from '../contracts.ts'
import { getDeteriorationStage } from './deterioration.ts'
import {
  angleDelta,
  clampToArena,
  isClearOfIslands,
  normalizeAngle,
  resolveShipPosition,
  segmentCircleHit,
  segmentHitsIsland,
  turnToward,
} from './geometry.ts'

describe('angles', () => {
  it('normalizes into (-pi, pi]', () => {
    expect(normalizeAngle(0)).toBe(0)
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI)
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI)
    expect(normalizeAngle(Math.PI / 2 + Math.PI * 4)).toBeCloseTo(Math.PI / 2)
    expect(normalizeAngle(-Math.PI / 2 - Math.PI * 4)).toBeCloseTo(-Math.PI / 2)
  })

  it('angleDelta takes the shortest way (positive = clockwise)', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2)
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2)
  })

  it('turnToward never overshoots and is limited by the max delta', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25)
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1)
    expect(turnToward(0, -1, 0.25)).toBeCloseTo(-0.25)
    expect(turnToward(Math.PI - 0.05, -Math.PI + 0.05, 0.25)).toBeCloseTo(-Math.PI + 0.05)
  })
})

describe('segmentCircleHit', () => {
  it('returns the entry parameter for a straight hit', () => {
    // Circle radius 10 at x=100: entry at x=90 -> t = 0.9 for a 100 long segment.
    expect(segmentCircleHit(0, 0, 100, 0, 100, 0, 10)).toBeCloseTo(0.9)
  })

  it('does not tunnel: a segment much longer than the circle still hits', () => {
    expect(segmentCircleHit(0, 0, 10_000, 0, 5_000, 0, 1)).toBeGreaterThanOrEqual(0)
  })

  it('misses when the segment stops short, passes beside or points away', () => {
    expect(segmentCircleHit(0, 0, 50, 0, 100, 0, 10)).toBe(-1)
    expect(segmentCircleHit(0, 0, 200, 0, 100, 30, 10)).toBe(-1)
    expect(segmentCircleHit(0, 0, -100, 0, 100, 0, 10)).toBe(-1)
  })

  it('reports 0 when the segment starts inside', () => {
    expect(segmentCircleHit(100, 0, 200, 0, 100, 0, 10)).toBe(0)
  })

  it('handles zero-length segments', () => {
    expect(segmentCircleHit(0, 0, 0, 0, 100, 0, 10)).toBe(-1)
    expect(segmentCircleHit(100, 0, 100, 0, 100, 0, 10)).toBe(0)
  })

  it('segmentHitsIsland checks every island with padding', () => {
    const islands = [{ x: 100, y: 0, radius: 10 }]
    expect(segmentHitsIsland(0, 0, 200, 0, islands)).toBe(true)
    expect(segmentHitsIsland(0, 20, 200, 20, islands)).toBe(false)
    expect(segmentHitsIsland(0, 20, 200, 20, islands, 15)).toBe(true)
  })
})

describe('ship placement', () => {
  const islands = [{ x: 500, y: 400, radius: 80 }]

  it('pushes a ship out of an island along the normal', () => {
    const body = { x: 500 + 50, y: 400 }
    resolveShipPosition(body, 20, islands)
    expect(Math.hypot(body.x - 500, body.y - 400)).toBeCloseTo(100)
    expect(body.y).toBeCloseTo(400)
  })

  it('handles a ship exactly on the island centre without NaN', () => {
    const body = { x: 500, y: 400 }
    resolveShipPosition(body, 20, islands)
    expect(Number.isFinite(body.x) && Number.isFinite(body.y)).toBe(true)
    expect(Math.hypot(body.x - 500, body.y - 400)).toBeCloseTo(100)
  })

  it('keeps ships inside the arena', () => {
    const body = { x: -50, y: ARENA.height + 50 }
    clampToArena(body, 20)
    expect(body).toEqual({ x: 20, y: ARENA.height - 20 })
  })

  it('an island next to the border cannot push a ship out of the arena', () => {
    const border = [{ x: 60, y: 450, radius: 50 }]
    const body = { x: 60, y: 452 }
    resolveShipPosition(body, 20, border)
    expect(body.x).toBeGreaterThanOrEqual(20)
    expect(body.x).toBeLessThanOrEqual(ARENA.width - 20)
  })

  it('isClearOfIslands honours the margin', () => {
    expect(isClearOfIslands(600, 400, 20, islands)).toBe(true)
    expect(isClearOfIslands(600, 400, 20, islands, 10)).toBe(false)
  })
})

describe('deterioration stages', () => {
  it('maps health ratio to 0..3 with the default 75/50/25 thresholds', () => {
    expect(getDeteriorationStage(100, 100)).toBe(0)
    expect(getDeteriorationStage(76, 100)).toBe(0)
    expect(getDeteriorationStage(75, 100)).toBe(1)
    expect(getDeteriorationStage(51, 100)).toBe(1)
    expect(getDeteriorationStage(50, 100)).toBe(2)
    expect(getDeteriorationStage(26, 100)).toBe(2)
    expect(getDeteriorationStage(25, 100)).toBe(3)
    expect(getDeteriorationStage(1, 100)).toBe(3)
    expect(getDeteriorationStage(0, 100)).toBe(3)
  })

  it('accepts custom thresholds and guards an invalid max', () => {
    expect(getDeteriorationStage(60, 100, [0.9, 0.7, 0.5])).toBe(2)
    expect(getDeteriorationStage(10, 0)).toBe(3)
  })
})
