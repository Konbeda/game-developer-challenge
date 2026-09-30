import { DEFAULT_GAMEPLAY, type GameplayConfig } from '../../config/gameplay.ts'
import type { EndReason, MatchResult } from '../../contracts/match.ts'
import {
  ARENA,
  type EnemyKind,
  type InputState,
  type MatchSettings,
  type SimEvent,
  type SimSnapshot,
  type Simulation,
} from '../contracts.ts'
import { emit } from './combat.ts'
import { fireEnemyWeapons, resolveEnemyContacts, updateEnemies } from './enemies.ts'
import { firePlayerWeapons, updatePlayer } from './player.ts'
import { spawnProjectile, updateProjectiles } from './projectiles.ts'
import { createRng } from './rng.ts'
import { addEnemy, createSpawnerState, updateSpawner } from './spawner.ts'
import { firstStepAtOrAfter, stepsToMs } from './time.ts'
import { compact, type World } from './world.ts'

function createWorld(settings: MatchSettings, gameplay: GameplayConfig): World {
  const { player: cfg } = gameplay
  return {
    settings,
    gameplay,
    rng: createRng(settings.seed),
    sessionSteps: firstStepAtOrAfter(settings.config.sessionSeconds * 1000),
    step: 0,
    score: 0,
    nextId: 1,
    player: {
      x: cfg.start.x,
      y: cfg.start.y,
      angle: cfg.start.angle,
      speed: 0,
      health: cfg.maxHealth,
      maxHealth: cfg.maxHealth,
      frontReadyStep: 0,
      leftReadyStep: 0,
      rightReadyStep: 0,
    },
    enemies: [],
    projectiles: [],
    spawner: createSpawnerState(),
    events: [],
    result: null,
  }
}

/**
 * Closes the match. Precedence when both conditions hold in the same step: the player's death
 * wins over the clock (`player_destroyed`), because the damage was dealt within the session.
 */
function checkEnd(world: World): boolean {
  let endReason: EndReason | null = null
  if (world.player.health <= 0) endReason = 'player_destroyed'
  else if (world.step >= world.sessionSteps) endReason = 'time_up'
  if (!endReason) return false

  if (endReason === 'player_destroyed') {
    emit(world, { type: 'explosion', x: world.player.x, y: world.player.y, big: true })
  }
  const sessionMs = world.settings.config.sessionSeconds * 1000
  const result: MatchResult = {
    score: world.score,
    durationMs: Math.min(sessionMs, Math.round(stepsToMs(world.step))),
    endReason,
  }
  world.result = result
  emit(world, { type: 'match_end', result: { ...result } })
  return true
}

function stepWorld(world: World, input: Readonly<InputState>): void {
  if (world.result) return
  world.step += 1

  updatePlayer(world, input)
  updateEnemies(world)
  updateProjectiles(world)
  resolveEnemyContacts(world)
  compact(world.enemies)
  compact(world.projectiles)

  // The match may end here: from that moment nothing fires, spawns or scores any more.
  if (checkEnd(world)) return

  firePlayerWeapons(world, input)
  fireEnemyWeapons(world)
  updateSpawner(world)
}

function snapshotWorld(world: World): SimSnapshot {
  const { player, gameplay } = world
  return {
    timeMs: stepsToMs(world.step),
    phase: world.result ? 'ended' : 'running',
    score: world.score,
    arena: { width: ARENA.width, height: ARENA.height },
    player: {
      x: player.x,
      y: player.y,
      angle: player.angle,
      health: player.health,
      maxHealth: player.maxHealth,
    },
    enemies: world.enemies.map((e) => ({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      angle: e.angle,
      health: e.health,
      maxHealth: e.maxHealth,
    })),
    projectiles: world.projectiles.map((p) => ({
      id: p.id,
      owner: p.owner,
      x: p.x,
      y: p.y,
      angle: p.angle,
    })),
    islands: gameplay.islands.map((i) => ({ x: i.x, y: i.y, radius: i.radius })),
  }
}

function toSimulation(world: World): Simulation {
  return {
    step: (input) => stepWorld(world, input),
    snapshot: () => snapshotWorld(world),
    drainEvents: (): SimEvent[] => {
      const events = world.events
      world.events = []
      return events
    },
    result: () => (world.result ? { ...world.result } : null),
  }
}

/**
 * Creates a match. The same `settings.seed` and the same sequence of `step(input)` calls always
 * produce identical snapshots. `gameplay` defaults to the shipped tuning.
 */
export function createSimulation(
  settings: MatchSettings,
  gameplay: GameplayConfig = DEFAULT_GAMEPLAY,
): Simulation {
  return toSimulation(createWorld(settings, gameplay))
}

/** Test/tooling access to the raw state. Not used by the game. */
export interface DebugSimulation extends Simulation {
  debug: {
    /** Live internal state: mutate it to stage scenarios. */
    world: World
    /** Adds an enemy at an exact pose and returns its id. */
    addEnemy(kind: EnemyKind, x: number, y: number, angle?: number): number
    /** Adds a projectile as if fired by `owner`, using that owner's front cannon / shooter stats. */
    addProjectile(owner: 'player' | 'enemy', x: number, y: number, angle: number): void
  }
}

export function createDebugSimulation(
  settings: MatchSettings,
  gameplay: GameplayConfig = DEFAULT_GAMEPLAY,
): DebugSimulation {
  const world = createWorld(settings, gameplay)
  return {
    ...toSimulation(world),
    debug: {
      world,
      addEnemy: (kind, x, y, angle = 0) => addEnemy(world, kind, x, y, angle),
      addProjectile: (owner, x, y, angle) =>
        spawnProjectile(
          world,
          owner,
          x,
          y,
          angle,
          owner === 'player' ? gameplay.player.frontCannon.projectile : gameplay.shooter.projectile,
        ),
    },
  }
}
