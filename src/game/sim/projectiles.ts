import type { ProjectileConfig } from '../../config/gameplay.ts'
import { ARENA } from '../contracts.ts'
import { damageEnemyByPlayer, damagePlayer, emit } from './combat.ts'
import { segmentCircleHit } from './geometry.ts'
import { DT } from './time.ts'
import type { EnemyState, ProjectileState, World } from './world.ts'

/** Creates a projectile at (x, y) travelling along `angle`, and reports the shot. */
export function spawnProjectile(
  world: World,
  owner: ProjectileState['owner'],
  x: number,
  y: number,
  angle: number,
  config: ProjectileConfig,
): void {
  world.projectiles.push({
    id: world.nextId++,
    owner,
    x,
    y,
    angle,
    dirX: Math.cos(angle),
    dirY: Math.sin(angle),
    speed: config.speed,
    damage: config.damage,
    radius: config.radius,
    remainingRange: config.range,
    alive: true,
  })
  emit(world, { type: 'shot', owner, x, y, angle })
}

/**
 * Moves every projectile one step with a swept (segment vs circle) test against islands and its
 * single valid target kind: player projectiles hit enemies only, enemy projectiles hit the player
 * only. The earliest contact along the path wins, damage is applied once and the projectile is
 * removed on impact, expiry (range) or when it leaves the arena.
 */
export function updateProjectiles(world: World): void {
  const { projectiles, enemies, player, gameplay } = world
  const playerRadius = gameplay.player.radius

  for (const p of projectiles) {
    if (!p.alive) continue
    const travel = Math.min(p.speed * DT, p.remainingRange)
    const x1 = p.x + p.dirX * travel
    const y1 = p.y + p.dirY * travel

    let bestT = Infinity
    let hitEnemy: EnemyState | null = null
    let hitPlayer = false

    for (const island of gameplay.islands) {
      const t = segmentCircleHit(p.x, p.y, x1, y1, island.x, island.y, island.radius + p.radius)
      if (t >= 0 && t < bestT) bestT = t
    }

    if (p.owner === 'player') {
      for (const enemy of enemies) {
        if (!enemy.alive) continue
        const t = segmentCircleHit(p.x, p.y, x1, y1, enemy.x, enemy.y, enemy.radius + p.radius)
        if (t >= 0 && t < bestT) {
          bestT = t
          hitEnemy = enemy
        }
      }
    } else if (player.health > 0) {
      const t = segmentCircleHit(p.x, p.y, x1, y1, player.x, player.y, playerRadius + p.radius)
      if (t >= 0 && t < bestT) {
        bestT = t
        hitPlayer = true
      }
    }

    if (bestT !== Infinity) {
      const hitX = p.x + (x1 - p.x) * bestT
      const hitY = p.y + (y1 - p.y) * bestT
      p.alive = false
      if (hitEnemy) {
        emit(world, { type: 'hit', target: 'enemy', x: hitX, y: hitY })
        damageEnemyByPlayer(world, hitEnemy, p.damage)
      } else if (hitPlayer) {
        emit(world, { type: 'hit', target: 'player', x: hitX, y: hitY })
        damagePlayer(world, p.damage)
      } else {
        emit(world, { type: 'hit', target: 'island', x: hitX, y: hitY })
      }
      continue
    }

    p.x = x1
    p.y = y1
    p.remainingRange -= travel
    const outside = x1 < 0 || x1 > ARENA.width || y1 < 0 || y1 > ARENA.height
    if (p.remainingRange <= 0 || outside) p.alive = false
  }
}
