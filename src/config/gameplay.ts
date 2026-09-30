import { ARENA } from '../game/contracts.ts'

/**
 * Central, typed gameplay tuning. Every number the simulation uses lives here: changing the
 * balance never requires touching a system.
 *
 * Units: distances in world units ("px" of the 1600x900 arena), time in ms unless a name says
 * otherwise, speeds in px/s, accelerations in px/s^2, angles in radians, turn rates in rad/s.
 * Angle convention: 0 points east (+x), positive rotation is clockwise on screen (y grows down).
 *
 * The two player-tunable values (session length and spawn interval) are NOT here: they come from
 * `MatchSettings.config` so that each match uses the options captured when it started.
 */

export interface ProjectileConfig {
  /** Travel speed in px/s. */
  speed: number
  /** Health removed from the target on impact. Applied exactly once per projectile. */
  damage: number
  /** Maximum travel distance in px. Lifetime is `range / speed`. */
  range: number
  /** Collision radius in px (added to the target radius in the swept test). */
  radius: number
}

export interface WeaponSlotConfig {
  /** Minimum time between two shots of this weapon, in ms. Each weapon has its own cooldown. */
  cooldownMs: number
  projectile: ProjectileConfig
}

export interface PlayerConfig {
  maxHealth: number
  /** Hull collision radius in px. */
  radius: number
  /** Top forward speed in px/s. */
  maxSpeed: number
  /** Speed gained per second while `forward` is held (px/s^2). */
  acceleration: number
  /** Speed lost per second when `forward` is released (px/s^2). Ships stop quickly, not instantly. */
  deceleration: number
  /** Rotation speed in rad/s (works while stationary too). */
  turnRate: number
  /** Where the player starts. The point must be free water. */
  start: { x: number; y: number; angle: number }
  /** Gap in px between the hull edge and the muzzle where projectiles appear. */
  muzzleClearance: number
  frontCannon: WeaponSlotConfig
  broadside: WeaponSlotConfig & {
    /** Parallel projectiles per volley, fired perpendicular to the heading. */
    shotsPerSide: number
    /** Distance in px between neighbouring parallel projectiles, measured along the hull. */
    shotSpacing: number
  }
}

/** Fields shared by every enemy kind. */
export interface EnemyBaseConfig {
  health: number
  /** Hull collision radius in px. */
  radius: number
  /** Top speed in px/s. */
  maxSpeed: number
  /** Speed change per second toward the wanted speed (px/s^2). */
  acceleration: number
  /** Rotation speed limit in rad/s. */
  turnRate: number
}

export interface ChaserConfig extends EnemyBaseConfig {
  /** Damage dealt to the player when the chaser hits the ship (it explodes and does not score). */
  contactDamage: number
}

export interface ShooterConfig extends EnemyBaseConfig {
  /** Fires only when the player is closer than this (px) and in line of fire. */
  attackRange: number
  /** The shooter approaches until this distance (px), then holds position and keeps aiming. */
  preferredDistance: number
  /** Max angle error (rad) between heading and player bearing to allow a shot. */
  aimTolerance: number
  cooldownMs: number
  /** Delay after spawning before the first shot, in ms. */
  initialDelayMs: number
  projectile: ProjectileConfig
}

/** Island avoidance used by enemies when their path to the player is blocked. */
export interface SteeringConfig {
  /** Distance ahead (px, measured from the inflated island edge) at which avoidance starts. */
  lookahead: number
  /** Extra clearance (px) kept between an enemy hull and an island while going around it. */
  clearanceMargin: number
}

export interface SpawnConfig {
  /** Cap on simultaneous enemies. A spawn tick skipped because of the cap creates no extra enemy. */
  maxEnemies: number
  /** Minimum distance (px) between a spawn point and the player. */
  minPlayerDistance: number
  /** Distance (px) from the arena border where enemies appear. Raised to the ship radius if smaller. */
  edgeInset: number
  /** Extra clearance (px) between a spawn point and island edges, on top of the ship radius. */
  islandMargin: number
  /** Extra gap (px) between a spawn point and other enemies, on top of both ship radii. */
  enemySpacing: number
  /** Random candidate points tried before the deterministic fallback. */
  attempts: number
  /** Distance (px) between candidates of the deterministic fallback walk along the border. */
  fallbackStep: number
  /**
   * Shuffle-bag distribution: each round the bag holds this many copies of each kind (integers),
   * shuffled with the seeded RNG. Any window of one bag length contains every kind with a
   * non-zero weight, so both kinds are guaranteed to appear in a default match.
   */
  kindWeights: { chaser: number; shooter: number }
}

export interface IslandConfig {
  x: number
  y: number
  radius: number
}

export interface GameplayConfig {
  player: PlayerConfig
  chaser: ChaserConfig
  shooter: ShooterConfig
  steering: SteeringConfig
  spawn: SpawnConfig
  /** Fixed, hand-designed layout. Islands block ships and projectiles. */
  islands: readonly IslandConfig[]
  deterioration: {
    /**
     * Health ratios (descending) below or equal to which a ship enters visual stage 1, 2 and 3.
     * Stage 0 is "pristine": ratio above the first threshold.
     */
    thresholds: readonly [number, number, number]
  }
  events: {
    /** Safety cap of buffered events when the host does not drain them. `match_end` is always kept. */
    maxBuffered: number
  }
}

export const DEFAULT_GAMEPLAY: GameplayConfig = {
  player: {
    maxHealth: 100,
    radius: 24,
    maxSpeed: 220,
    acceleration: 650,
    deceleration: 1300,
    turnRate: 2.3,
    start: { x: ARENA.width * 0.15, y: ARENA.height * 0.5, angle: 0 },
    muzzleClearance: 6,
    frontCannon: {
      cooldownMs: 350,
      projectile: { speed: 640, damage: 20, range: 720, radius: 5 },
    },
    broadside: {
      cooldownMs: 1400,
      projectile: { speed: 560, damage: 20, range: 520, radius: 5 },
      shotsPerSide: 3,
      shotSpacing: 24,
    },
  },
  chaser: {
    health: 40,
    radius: 22,
    maxSpeed: 150,
    acceleration: 320,
    turnRate: 1.8,
    contactDamage: 25,
  },
  shooter: {
    health: 60,
    radius: 24,
    maxSpeed: 95,
    acceleration: 220,
    turnRate: 1.4,
    attackRange: 520,
    preferredDistance: 340,
    aimTolerance: 0.14,
    cooldownMs: 1800,
    initialDelayMs: 1200,
    projectile: { speed: 340, damage: 10, range: 620, radius: 6 },
  },
  steering: { lookahead: 260, clearanceMargin: 18 },
  spawn: {
    maxEnemies: 10,
    minPlayerDistance: 480,
    edgeInset: 50,
    islandMargin: 40,
    enemySpacing: 60,
    attempts: 16,
    fallbackStep: 100,
    kindWeights: { chaser: 3, shooter: 2 },
  },
  // Five islands leave corridors of at least ~300 px between them and ~100 px to the borders.
  islands: [
    { x: 800, y: 450, radius: 90 },
    { x: 420, y: 190, radius: 70 },
    { x: 1200, y: 720, radius: 80 },
    { x: 1250, y: 210, radius: 60 },
    { x: 380, y: 720, radius: 55 },
  ],
  deterioration: { thresholds: [0.75, 0.5, 0.25] },
  events: { maxBuffered: 4096 },
}
