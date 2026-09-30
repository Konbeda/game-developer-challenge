import type { EnemyBaseConfig, GameplayConfig } from '../../config/gameplay.ts'
import { damagePlayer, destroyEnemy, emit } from './combat.ts'
import {
  angleDelta,
  approach,
  EPSILON,
  normalizeAngle,
  resolveShipPosition,
  segmentHitsIsland,
  turnToward,
} from './geometry.ts'
import { spawnProjectile } from './projectiles.ts'
import { DT, msToSteps } from './time.ts'
import type { EnemyState, World } from './world.ts'

function baseConfig(gameplay: GameplayConfig, kind: EnemyState['kind']): EnemyBaseConfig {
  return kind === 'chaser' ? gameplay.chaser : gameplay.shooter
}

/**
 * Wanted heading toward (tx, ty). When an island sits on the straight path, the heading is
 * blended toward the tangent that skirts the (inflated) island; the blend grows as the ship gets
 * closer. Going around on the side the island is already on keeps the path stable.
 */
function steerAngle(enemy: EnemyState, tx: number, ty: number, world: World): number {
  const { lookahead, clearanceMargin } = world.gameplay.steering
  const toTarget = Math.atan2(ty - enemy.y, tx - enemy.x)
  const dirX = Math.cos(toTarget)
  const dirY = Math.sin(toTarget)
  const targetDistance = Math.hypot(tx - enemy.x, ty - enemy.y)

  let nearest = Infinity
  let blockerAngle = 0
  let blockerClearance = 0
  let blockerLateral = 0
  for (const island of world.gameplay.islands) {
    const dx = island.x - enemy.x
    const dy = island.y - enemy.y
    const ahead = dx * dirX + dy * dirY
    if (ahead <= 0 || ahead > targetDistance + island.radius) continue
    const clearance = island.radius + enemy.radius + clearanceMargin
    const dist = Math.hypot(dx, dy)
    if (dist - clearance > lookahead) continue
    const lateral = dirX * dy - dirY * dx
    if (Math.abs(lateral) >= clearance) continue
    if (dist < nearest) {
      nearest = dist
      blockerAngle = Math.atan2(dy, dx)
      blockerClearance = clearance
      blockerLateral = lateral
    }
  }
  if (nearest === Infinity) return toTarget

  // Island on our right (clockwise of the path): pass on its left, and vice versa. Dead centre:
  // an id-based side keeps the choice deterministic and varies it between enemies.
  const side =
    Math.abs(blockerLateral) < EPSILON ? (enemy.id % 2 === 0 ? 1 : -1) : blockerLateral > 0 ? -1 : 1
  const tangent = blockerAngle + side * Math.asin(Math.min(1, blockerClearance / nearest))
  const weight = Math.min(1, Math.max(0, 1 - (nearest - blockerClearance) / lookahead))
  return Math.atan2(
    (1 - weight) * dirY + weight * Math.sin(tangent),
    (1 - weight) * dirX + weight * Math.cos(tangent),
  )
}

function hasLineOfFire(enemy: EnemyState, world: World): boolean {
  const { player, gameplay } = world
  return !segmentHitsIsland(enemy.x, enemy.y, player.x, player.y, gameplay.islands)
}

/** Steers, accelerates and moves every enemy, then resolves overlaps with ships, islands and borders. */
export function updateEnemies(world: World): void {
  const { player, enemies, gameplay } = world

  for (const enemy of enemies) {
    if (!enemy.alive) continue
    const cfg = baseConfig(gameplay, enemy.kind)

    const wanted = steerAngle(enemy, player.x, player.y, world)
    enemy.angle = turnToward(enemy.angle, wanted, cfg.turnRate * DT)

    let targetSpeed = cfg.maxSpeed
    if (enemy.kind === 'shooter') {
      // Hold position once at preferred distance, unless islands hide the player (then reposition).
      const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y)
      if (dist <= gameplay.shooter.preferredDistance && hasLineOfFire(enemy, world)) targetSpeed = 0
    }
    enemy.speed = approach(enemy.speed, targetSpeed, cfg.acceleration * DT)
    enemy.x += Math.cos(enemy.angle) * enemy.speed * DT
    enemy.y += Math.sin(enemy.angle) * enemy.speed * DT
  }

  separateEnemies(world)

  for (const enemy of enemies) {
    if (!enemy.alive) continue
    if (enemy.kind === 'shooter') pushOutOfPlayer(enemy, world)
    resolveShipPosition(enemy, enemy.radius, gameplay.islands)
  }
}

/** Soft ship-to-ship collision so enemies never stack on the exact same spot. */
function separateEnemies(world: World): void {
  const { enemies } = world
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i] as EnemyState
    if (!a.alive) continue
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j] as EnemyState
      if (!b.alive) continue
      const min = a.radius + b.radius
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distSq = dx * dx + dy * dy
      if (distSq >= min * min) continue
      const dist = Math.sqrt(distSq)
      const nx = dist < EPSILON ? 1 : dx / dist
      const ny = dist < EPSILON ? 0 : dy / dist
      // Each ship absorbs half of the overlap.
      const push = (min - dist) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
    }
  }
}

/** Shooters are solid to the player (no damage): they are pushed out of the player's hull. */
function pushOutOfPlayer(enemy: EnemyState, world: World): void {
  const { player, gameplay } = world
  const min = gameplay.player.radius + enemy.radius
  const dx = enemy.x - player.x
  const dy = enemy.y - player.y
  const distSq = dx * dx + dy * dy
  if (distSq >= min * min) return
  const dist = Math.sqrt(distSq)
  const nx = dist < EPSILON ? 1 : dx / dist
  const ny = dist < EPSILON ? 0 : dy / dist
  enemy.x = player.x + nx * min
  enemy.y = player.y + ny * min
}

/** Chasers that touch the player's hull damage it and explode. They never score. */
export function resolveEnemyContacts(world: World): void {
  const { player, enemies, gameplay } = world
  if (player.health <= 0) return
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.kind !== 'chaser') continue
    const min = gameplay.player.radius + enemy.radius
    const dx = enemy.x - player.x
    const dy = enemy.y - player.y
    if (dx * dx + dy * dy > min * min) continue
    const contactX = (enemy.x + player.x) / 2
    const contactY = (enemy.y + player.y) / 2
    emit(world, { type: 'hit', target: 'player', x: contactX, y: contactY })
    damagePlayer(world, gameplay.chaser.contactDamage)
    destroyEnemy(world, enemy, false)
    if (player.health <= 0) return
  }
}

/** Shooters fire when the player is in range, they face it, the line of fire is clear and the cooldown allows. */
export function fireEnemyWeapons(world: World): void {
  const { player, enemies, gameplay, step } = world
  if (player.health <= 0) return
  const cfg = gameplay.shooter
  for (const enemy of enemies) {
    if (!enemy.alive || enemy.kind !== 'shooter' || step < enemy.nextFireStep) continue
    const dx = player.x - enemy.x
    const dy = player.y - enemy.y
    if (dx * dx + dy * dy > cfg.attackRange * cfg.attackRange) continue
    const aimError = Math.abs(angleDelta(enemy.angle, Math.atan2(dy, dx)))
    if (aimError > cfg.aimTolerance) continue
    if (!hasLineOfFire(enemy, world)) continue

    enemy.nextFireStep = step + msToSteps(cfg.cooldownMs)
    const muzzle = enemy.radius + cfg.projectile.radius
    spawnProjectile(
      world,
      'enemy',
      enemy.x + Math.cos(enemy.angle) * muzzle,
      enemy.y + Math.sin(enemy.angle) * muzzle,
      normalizeAngle(enemy.angle),
      cfg.projectile,
    )
  }
}
