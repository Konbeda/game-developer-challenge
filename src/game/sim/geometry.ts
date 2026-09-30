import { ARENA } from '../contracts.ts'
import type { IslandConfig } from '../../config/gameplay.ts'

export const EPSILON = 1e-9
export const TWO_PI = Math.PI * 2
export const HALF_PI = Math.PI / 2

/** Bounded passes when a ship is squeezed between islands and the arena border. */
const RESOLVE_ITERATIONS = 4

export interface Point {
  x: number
  y: number
}

/** Wraps an angle into (-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let a = angle % TWO_PI
  if (a > Math.PI) a -= TWO_PI
  else if (a <= -Math.PI) a += TWO_PI
  return a
}

/** Shortest signed rotation (rad) that takes `from` to `to`. Positive is clockwise. */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from)
}

/** Rotates `current` toward `target` by at most `maxDelta` radians. */
export function turnToward(current: number, target: number, maxDelta: number): number {
  const delta = angleDelta(current, target)
  if (Math.abs(delta) <= maxDelta) return normalizeAngle(target)
  return normalizeAngle(current + Math.sign(delta) * maxDelta)
}

/** Moves `value` toward `target` by at most `maxDelta`. */
export function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(target, value + maxDelta)
  return Math.max(target, value - maxDelta)
}

/**
 * Swept segment-vs-circle test. Returns the entry parameter t in [0, 1] along
 * (x0,y0)->(x1,y1), 0 if the segment starts inside the circle, or -1 when it misses.
 */
export function segmentCircleHit(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  radius: number,
): number {
  const fx = x0 - cx
  const fy = y0 - cy
  const c = fx * fx + fy * fy - radius * radius
  if (c <= 0) return 0
  const dx = x1 - x0
  const dy = y1 - y0
  const a = dx * dx + dy * dy
  if (a < EPSILON) return -1
  const b = fx * dx + fy * dy
  const discriminant = b * b - a * c
  if (discriminant < 0) return -1
  const t = (-b - Math.sqrt(discriminant)) / a
  return t >= 0 && t <= 1 ? t : -1
}

/** True when the segment touches any island (inflated by `pad`). */
export function segmentHitsIsland(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  islands: readonly IslandConfig[],
  pad = 0,
): boolean {
  for (const island of islands) {
    if (segmentCircleHit(x0, y0, x1, y1, island.x, island.y, island.radius + pad) >= 0) return true
  }
  return false
}

/** True when a circle of `radius` at (x,y) overlaps no island (each inflated by `margin`). */
export function isClearOfIslands(
  x: number,
  y: number,
  radius: number,
  islands: readonly IslandConfig[],
  margin = 0,
): boolean {
  for (const island of islands) {
    const min = island.radius + radius + margin
    const dx = x - island.x
    const dy = y - island.y
    if (dx * dx + dy * dy < min * min) return false
  }
  return true
}

export function clampToArena(body: Point, radius: number): void {
  body.x = Math.min(ARENA.width - radius, Math.max(radius, body.x))
  body.y = Math.min(ARENA.height - radius, Math.max(radius, body.y))
}

/**
 * Pushes a circular ship out of every island it overlaps (which makes it slide along the shore
 * instead of stopping dead) and back inside the arena. Speeds are far below the ship radius per
 * step, so a ship can never tunnel through an island.
 */
export function resolveShipPosition(
  body: Point,
  radius: number,
  islands: readonly IslandConfig[],
): void {
  for (let pass = 0; pass < RESOLVE_ITERATIONS; pass++) {
    let moved = false
    for (const island of islands) {
      const min = island.radius + radius
      const dx = body.x - island.x
      const dy = body.y - island.y
      const distSq = dx * dx + dy * dy
      if (distSq >= min * min) continue
      const dist = Math.sqrt(distSq)
      // Ship exactly on the island centre: any direction works, pick +x for determinism.
      const nx = dist < EPSILON ? 1 : dx / dist
      const ny = dist < EPSILON ? 0 : dy / dist
      body.x = island.x + nx * min
      body.y = island.y + ny * min
      moved = true
    }
    clampToArena(body, radius)
    if (!moved) return
  }
}
