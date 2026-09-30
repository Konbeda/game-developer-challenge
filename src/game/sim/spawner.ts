import type { EnemyKind } from '../contracts.ts'
import { ARENA } from '../contracts.ts'
import { getEnemyMaxHealth } from './combat.ts'
import { isClearOfIslands, type Point } from './geometry.ts'
import { firstStepAtOrAfter, msToSteps } from './time.ts'
import type { SpawnerState, World } from './world.ts'

const ENEMY_KINDS: readonly EnemyKind[] = ['chaser', 'shooter']

export function createSpawnerState(): SpawnerState {
  return { nextTick: 1, bag: [] }
}

/** Adds an enemy to the world at an exact pose (used by the spawner and by test tooling). */
export function addEnemy(
  world: World,
  kind: EnemyKind,
  x: number,
  y: number,
  angle: number,
): number {
  const { gameplay } = world
  const cfg = kind === 'chaser' ? gameplay.chaser : gameplay.shooter
  const id = world.nextId++
  world.enemies.push({
    id,
    kind,
    x,
    y,
    angle,
    speed: 0,
    health: getEnemyMaxHealth(kind, gameplay),
    maxHealth: getEnemyMaxHealth(kind, gameplay),
    radius: cfg.radius,
    alive: true,
    nextFireStep: world.step + msToSteps(gameplay.shooter.initialDelayMs),
  })
  return id
}

/**
 * One spawn per tick. Tick k happens at t = k * spawnIntervalMs (the first one is NOT at t = 0),
 * so at most floor(duration / interval) enemies can ever exist and the score is bounded by it.
 * A tick skipped by the enemy cap (or a lack of free space) simply produces nothing.
 */
export function updateSpawner(world: World): void {
  const spawner = world.spawner
  const dueStep = firstStepAtOrAfter(spawner.nextTick * world.settings.config.spawnIntervalMs)
  if (world.step < dueStep) return
  spawner.nextTick += 1

  const { gameplay, player } = world
  if (world.enemies.length >= gameplay.spawn.maxEnemies) return

  const kind = drawKind(world)
  const radius = kind === 'chaser' ? gameplay.chaser.radius : gameplay.shooter.radius
  const point = findSpawnPoint(world, radius)
  if (!point) return
  addEnemy(world, kind, point.x, point.y, Math.atan2(player.y - point.y, player.x - point.x))
}

/** Shuffle bag: a round contains `kindWeights` copies of each kind, so kinds are well distributed. */
function drawKind(world: World): EnemyKind {
  const { spawner, gameplay, rng } = world
  if (spawner.bag.length === 0) {
    for (const kind of ENEMY_KINDS) {
      const copies = Math.max(0, Math.floor(gameplay.spawn.kindWeights[kind]))
      for (let i = 0; i < copies; i++) spawner.bag.push(kind)
    }
    if (spawner.bag.length === 0) spawner.bag.push(...ENEMY_KINDS)
    rng.shuffle(spawner.bag)
  }
  return spawner.bag.pop() ?? 'chaser'
}

/** Point at `distance` px along the border ring, walking clockwise from the top-left corner. */
function ringPoint(distance: number, inset: number): Point {
  const width = ARENA.width - 2 * inset
  const height = ARENA.height - 2 * inset
  let d = distance
  if (d < width) return { x: inset + d, y: inset }
  d -= width
  if (d < height) return { x: ARENA.width - inset, y: inset + d }
  d -= height
  if (d < width) return { x: ARENA.width - inset - d, y: ARENA.height - inset }
  d -= width
  return { x: inset, y: ARENA.height - inset - d }
}

/**
 * Valid spawn point: just inside the arena border, clear of islands (with margin), at least
 * `minPlayerDistance` from the player and away from other enemies. Seeded random candidates come
 * first; if none is valid, a deterministic walk along the border picks the island-free point
 * farthest from the player. Returns null only if every border point is blocked by islands.
 */
function findSpawnPoint(world: World, radius: number): Point | null {
  const { gameplay, rng, player, enemies } = world
  const cfg = gameplay.spawn
  const inset = Math.max(cfg.edgeInset, radius)
  const perimeter = 2 * (ARENA.width - 2 * inset + (ARENA.height - 2 * inset))
  const islandClearance = cfg.islandMargin

  for (let attempt = 0; attempt < cfg.attempts; attempt++) {
    const candidate = ringPoint(rng.next() * perimeter, inset)
    if (!isClearOfIslands(candidate.x, candidate.y, radius, gameplay.islands, islandClearance))
      continue
    if (Math.hypot(candidate.x - player.x, candidate.y - player.y) < cfg.minPlayerDistance) continue
    const crowded = enemies.some(
      (other) =>
        other.alive &&
        Math.hypot(candidate.x - other.x, candidate.y - other.y) <
          radius + other.radius + cfg.enemySpacing,
    )
    if (crowded) continue
    return candidate
  }

  let best: Point | null = null
  let bestDistance = -1
  for (let distance = 0; distance < perimeter; distance += Math.max(1, cfg.fallbackStep)) {
    const candidate = ringPoint(distance, inset)
    if (!isClearOfIslands(candidate.x, candidate.y, radius, gameplay.islands, islandClearance))
      continue
    const fromPlayer = Math.hypot(candidate.x - player.x, candidate.y - player.y)
    if (fromPlayer > bestDistance) {
      bestDistance = fromPlayer
      best = candidate
    }
  }
  return best
}
