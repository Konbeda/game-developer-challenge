import type { EnemyKind, SimEvent } from '../contracts.ts'
import type { GameplayConfig } from '../../config/gameplay.ts'
import type { EnemyState, World } from './world.ts'

export function emit(world: World, event: SimEvent): void {
  // A host that never drains must not grow memory forever. The end of the match is never dropped.
  if (world.events.length >= world.gameplay.events.maxBuffered && event.type !== 'match_end') return
  world.events.push(event)
}

/** Full health of an enemy kind (renderers can pair it with the snapshot's `health`). */
export function getEnemyMaxHealth(kind: EnemyKind, gameplay: GameplayConfig): number {
  return kind === 'chaser' ? gameplay.chaser.health : gameplay.shooter.health
}

/** Reduces the player's health (never below zero) and reports it. */
export function damagePlayer(world: World, amount: number): void {
  const player = world.player
  player.health = Math.max(0, player.health - amount)
  emit(world, { type: 'player_damaged', health: player.health })
}

/**
 * Removes an enemy from play immediately (it stops colliding, firing and damaging) and emits the
 * destruction events. Points are awarded only when the player's projectiles did it.
 */
export function destroyEnemy(world: World, enemy: EnemyState, byPlayer: boolean): void {
  if (!enemy.alive) return
  enemy.alive = false
  if (byPlayer) world.score += 1
  emit(world, { type: 'enemy_destroyed', kind: enemy.kind, x: enemy.x, y: enemy.y, byPlayer })
  emit(world, { type: 'explosion', x: enemy.x, y: enemy.y, big: true })
}

/** Applies projectile damage to an enemy; destroys it when health reaches zero. */
export function damageEnemyByPlayer(world: World, enemy: EnemyState, amount: number): void {
  if (!enemy.alive) return
  enemy.health = Math.max(0, enemy.health - amount)
  if (enemy.health <= 0) destroyEnemy(world, enemy, true)
}
