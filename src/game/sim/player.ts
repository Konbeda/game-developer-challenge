import type { InputState } from '../contracts.ts'
import { approach, HALF_PI, normalizeAngle, resolveShipPosition } from './geometry.ts'
import { spawnProjectile } from './projectiles.ts'
import { DT, msToSteps } from './time.ts'
import type { World } from './world.ts'

/** Which side of the hull a broadside fires from. Positive angles are clockwise (starboard). */
const PORT = -1
const STARBOARD = 1

/**
 * Turns, accelerates and moves the player, then keeps it in the arena and off the islands.
 * The ship only advances while `forward` is held; releasing it brakes to a stop.
 */
export function updatePlayer(world: World, input: Readonly<InputState>): void {
  const { player, gameplay } = world
  const cfg = gameplay.player

  const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0)
  player.angle = normalizeAngle(player.angle + turn * cfg.turnRate * DT)

  player.speed = input.forward
    ? approach(player.speed, cfg.maxSpeed, cfg.acceleration * DT)
    : approach(player.speed, 0, cfg.deceleration * DT)

  player.x += Math.cos(player.angle) * player.speed * DT
  player.y += Math.sin(player.angle) * player.speed * DT
  resolveShipPosition(player, cfg.radius, gameplay.islands)
}

/** Fires each requested weapon whose own cooldown has elapsed. */
export function firePlayerWeapons(world: World, input: Readonly<InputState>): void {
  const { player, gameplay, step } = world
  const cfg = gameplay.player
  const muzzleDistance = cfg.radius + cfg.muzzleClearance

  if (input.fireFront && step >= player.frontReadyStep) {
    player.frontReadyStep = step + msToSteps(cfg.frontCannon.cooldownMs)
    spawnProjectile(
      world,
      'player',
      player.x + Math.cos(player.angle) * muzzleDistance,
      player.y + Math.sin(player.angle) * muzzleDistance,
      player.angle,
      cfg.frontCannon.projectile,
    )
  }
  if (input.fireLeft && step >= player.leftReadyStep) {
    player.leftReadyStep = step + msToSteps(cfg.broadside.cooldownMs)
    fireBroadside(world, PORT)
  }
  if (input.fireRight && step >= player.rightReadyStep) {
    player.rightReadyStep = step + msToSteps(cfg.broadside.cooldownMs)
    fireBroadside(world, STARBOARD)
  }
}

/** Parallel volley perpendicular to the heading, spread evenly along the hull. */
function fireBroadside(world: World, side: typeof PORT | typeof STARBOARD): void {
  const { player, gameplay } = world
  const cfg = gameplay.player
  const shotAngle = normalizeAngle(player.angle + side * HALF_PI)
  const sideX = Math.cos(shotAngle)
  const sideY = Math.sin(shotAngle)
  const hullX = Math.cos(player.angle)
  const hullY = Math.sin(player.angle)
  const muzzleDistance = cfg.radius + cfg.muzzleClearance
  const { shotsPerSide, shotSpacing, projectile } = cfg.broadside
  const middle = (shotsPerSide - 1) / 2

  for (let i = 0; i < shotsPerSide; i++) {
    const along = (i - middle) * shotSpacing
    spawnProjectile(
      world,
      'player',
      player.x + sideX * muzzleDistance + hullX * along,
      player.y + sideY * muzzleDistance + hullY * along,
      shotAngle,
      projectile,
    )
  }
}
