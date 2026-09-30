import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js'
import type { GameTextures } from '../assets/loader.ts'
import {
  HEALTH_BAR,
  shipTextureName,
  type DamageStage,
  type ShipColor,
} from '../assets/manifest.ts'
import type { EnemyKind, SimEvent, SimSnapshot } from '../contracts.ts'
import { EffectSystem } from './effects.ts'

/** Visual size of a ship (sprite length in world units). Collision radii live in the simulation. */
const SHIP_LENGTH = 92
const SHIP_SPRITE_LENGTH = 113
const SHIP_SCALE = SHIP_LENGTH / SHIP_SPRITE_LENGTH
const BAR_SCALE = 0.5
const FLASH_MS = 130

const ENEMY_COLOR: Record<EnemyKind, ShipColor> = { chaser: 'red', shooter: 'black' }
const PLAYER_COLOR: ShipColor = 'blue'

/** Health ratio -> visual damage stage of a living ship (3 is reserved for the wreck). */
export function damageStage(health: number, maxHealth: number): DamageStage {
  if (health <= 0) return 3
  const ratio = health / maxHealth
  if (ratio > 0.66) return 0
  if (ratio > 0.33) return 1
  return 2
}

interface BarView {
  root: Container
  fill: Sprite
  lastPx: number
  lastColor: 'red' | 'green'
}

interface ShipView {
  root: Container
  body: Sprite
  fires: Sprite[]
  bar: BarView
  color: ShipColor
  stage: DamageStage
  health: number
  flashMs: number
  seen: boolean
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pixi scene for one arena. It only reads snapshots and events; it never mutates game state.
 * Coordinates are world units (ARENA); the host scales `root` to the screen.
 */
export class GameScene {
  readonly root = new Container()
  private readonly water: TilingSprite
  private readonly islandLayer = new Container()
  private readonly shipLayer = new Container()
  private readonly projectileLayer = new Container()
  private readonly trails = new Graphics()
  private readonly barLayer = new Container()
  private readonly effects: EffectSystem
  private readonly enemies = new Map<number, ShipView>()
  private readonly projectiles = new Map<number, Sprite>()
  private readonly projectilePool: Sprite[] = []
  private readonly fillTextures = new Map<string, Texture>()
  private player: ShipView | null = null
  private islandsBuilt = false
  private timeMs = 0
  private shakeMs = 0
  private readonly reducedMotion: boolean

  private readonly textures: GameTextures

  constructor(textures: GameTextures, arena: { width: number; height: number }) {
    this.textures = textures
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.water = new TilingSprite({
      texture: textures.get('tile_73'),
      width: arena.width,
      height: arena.height,
    })
    this.effects = new EffectSystem(textures)
    this.root.addChild(
      this.water,
      this.islandLayer,
      this.shipLayer,
      this.projectileLayer,
      this.trails,
      this.effects.layer,
      this.barLayer,
    )
  }

  get effectCount(): number {
    return this.effects.count
  }

  /** Clears entities and effects for a new match. Textures and the layer graph are reused. */
  reset(): void {
    for (const view of this.enemies.values()) this.disposeShip(view)
    this.enemies.clear()
    if (this.player) this.disposeShip(this.player)
    this.player = null
    for (const sprite of this.projectiles.values()) this.releaseProjectile(sprite)
    this.projectiles.clear()
    this.effects.clear()
    this.trails.clear()
    this.shakeMs = 0
    this.root.position.set(0, 0)
  }

  sync(snapshot: SimSnapshot): void {
    if (!this.islandsBuilt) this.buildIslands(snapshot.islands)

    // Player
    const p = snapshot.player
    if (!this.player) this.player = this.createShip(PLAYER_COLOR, 'green')
    this.updateShip(this.player, p.x, p.y, p.angle, p.health, p.maxHealth, 'green')

    // Enemies
    for (const view of this.enemies.values()) view.seen = false
    for (const e of snapshot.enemies) {
      let view = this.enemies.get(e.id)
      if (!view) {
        view = this.createShip(ENEMY_COLOR[e.kind], 'red')
        this.enemies.set(e.id, view)
      }
      view.seen = true
      this.updateShip(view, e.x, e.y, e.angle, e.health, e.maxHealth, 'red')
    }
    for (const [id, view] of this.enemies) {
      if (!view.seen) {
        this.disposeShip(view)
        this.enemies.delete(id)
      }
    }

    // Projectiles
    const live = new Set<number>()
    this.trails.clear()
    for (const b of snapshot.projectiles) {
      live.add(b.id)
      let sprite = this.projectiles.get(b.id)
      if (!sprite) {
        sprite = this.projectilePool.pop() ?? new Sprite(this.textures.get('cannon_ball'))
        sprite.texture = this.textures.get('cannon_ball')
        sprite.anchor.set(0.5)
        sprite.scale.set(1.5)
        sprite.visible = true
        this.projectileLayer.addChild(sprite)
        this.projectiles.set(b.id, sprite)
      }
      sprite.tint = b.owner === 'enemy' ? 0xff9a78 : 0xffffff
      sprite.position.set(b.x, b.y)
      const dx = Math.cos(b.angle) * 30
      const dy = Math.sin(b.angle) * 30
      this.trails.moveTo(b.x - dx, b.y - dy).lineTo(b.x, b.y)
    }
    this.trails.stroke({ width: 3, color: 0xffffff, alpha: 0.4, cap: 'round' })
    for (const [id, sprite] of this.projectiles) {
      if (!live.has(id)) {
        this.releaseProjectile(sprite)
        this.projectiles.delete(id)
      }
    }
  }

  /** Turns simulation events into feedback. Call before `sync` for the same step. */
  handleEvents(events: readonly SimEvent[]): void {
    const explosions = events.filter((e) => e.type === 'explosion')
    for (const event of events) {
      switch (event.type) {
        case 'shot':
          this.effects.muzzleFlash(event.x, event.y)
          break
        case 'hit':
          this.effects.impact(event.x, event.y, event.target === 'island' ? 0xe8d8a8 : 0xffb04a)
          break
        case 'explosion':
          this.effects.explosion(event.x, event.y, event.big)
          break
        case 'enemy_destroyed': {
          const view = this.nearestEnemy(event.x, event.y)
          const angle = view ? view.root.rotation + Math.PI / 2 : 0
          const nearExplosion = explosions.some(
            (e) => Math.hypot(e.x - event.x, e.y - event.y) < 40,
          )
          if (!nearExplosion) this.effects.explosion(event.x, event.y, true)
          this.effects.wreck(event.x, event.y, angle, ENEMY_COLOR[event.kind], SHIP_SCALE)
          this.effects.debris(event.x, event.y)
          break
        }
        case 'player_damaged':
          if (!this.reducedMotion) this.shakeMs = 220
          if (this.player) this.player.flashMs = FLASH_MS
          break
        case 'match_end':
          if (event.result.endReason === 'player_destroyed' && this.player) {
            const { x, y } = this.player.root
            this.effects.explosion(x, y, true)
            this.effects.debris(x, y)
          }
          break
      }
    }
  }

  /** Advances visual-only animation (water, flashes, effects, shake) by simulated time. */
  update(dtMs: number): void {
    this.timeMs += dtMs
    this.water.tilePosition.set(this.timeMs * 0.006, this.timeMs * 0.003)
    this.effects.update(dtMs)

    const animate = (view: ShipView) => {
      if (view.flashMs > 0) {
        view.flashMs = Math.max(0, view.flashMs - dtMs)
        view.body.tint = view.flashMs > 0 ? 0xff6a5a : 0xffffff
      }
      view.fires.forEach((fire, i) => {
        const flicker = 0.85 + 0.25 * Math.sin(this.timeMs * 0.02 + i * 2.1)
        fire.scale.set(flicker * (i === 0 ? 1.2 : 0.9))
        fire.alpha = 0.8 + 0.2 * Math.sin(this.timeMs * 0.03 + i)
      })
    }
    if (this.player) animate(this.player)
    for (const view of this.enemies.values()) animate(view)

    if (this.shakeMs > 0) {
      this.shakeMs = Math.max(0, this.shakeMs - dtMs)
      const amp = (this.shakeMs / 220) * 7
      this.root.position.set(Math.sin(this.timeMs * 0.09) * amp, Math.cos(this.timeMs * 0.11) * amp)
    } else if (this.root.position.x !== 0 || this.root.position.y !== 0) {
      this.root.position.set(0, 0)
    }
  }

  destroy(): void {
    this.reset()
    this.effects.destroy()
    for (const sprite of this.projectilePool) sprite.destroy()
    this.projectilePool.length = 0
    this.fillTextures.forEach((t) => t.destroy())
    this.fillTextures.clear()
    this.root.destroy({ children: true })
  }

  // ---- internals -----------------------------------------------------------

  private nearestEnemy(x: number, y: number): ShipView | null {
    let best: ShipView | null = null
    let bestDist = 90
    for (const view of this.enemies.values()) {
      const d = Math.hypot(view.root.x - x, view.root.y - y)
      if (d < bestDist) {
        bestDist = d
        best = view
      }
    }
    return best
  }

  private createShip(color: ShipColor, barColor: 'red' | 'green'): ShipView {
    const root = new Container()
    const body = new Sprite(this.textures.get(shipTextureName(color, 0)))
    body.anchor.set(0.5)
    body.scale.set(SHIP_SCALE)
    root.addChild(body)

    const fires: Sprite[] = []
    for (const [name, x, y] of [
      ['fire_1', -6, 6],
      ['fire_2', 8, -14],
    ] as const) {
      const fire = new Sprite(this.textures.get(name))
      fire.anchor.set(0.5, 0.85)
      fire.position.set(x, y)
      fire.visible = false
      root.addChild(fire)
      fires.push(fire)
    }
    this.shipLayer.addChild(root)

    const barRoot = new Container()
    const frame = new Sprite(this.textures.get('enemy_health_frame'))
    const fill = new Sprite(this.fillTexture(barColor, 1))
    barRoot.addChild(fill, frame)
    barRoot.pivot.set(HEALTH_BAR.width / 2, HEALTH_BAR.height / 2)
    barRoot.scale.set(BAR_SCALE)
    this.barLayer.addChild(barRoot)

    return {
      root,
      body,
      fires,
      bar: { root: barRoot, fill, lastPx: -1, lastColor: barColor },
      color,
      stage: 0,
      health: -1,
      flashMs: 0,
      seen: true,
    }
  }

  private updateShip(
    view: ShipView,
    x: number,
    y: number,
    angle: number,
    health: number,
    maxHealth: number,
    barColor: 'red' | 'green',
  ): void {
    view.root.position.set(x, y)
    // Sprites are drawn bow-down; simulation angle 0 points to +x (clockwise on screen).
    view.root.rotation = angle - Math.PI / 2

    const stage = damageStage(health, maxHealth)
    if (stage !== view.stage) {
      view.stage = stage
      view.body.texture = this.textures.get(shipTextureName(view.color, stage))
      view.fires.forEach((fire) => (fire.visible = stage >= 2))
    }
    if (view.health >= 0 && health < view.health) view.flashMs = FLASH_MS
    view.health = health

    const bar = view.bar
    bar.root.visible = health > 0
    bar.root.position.set(x, y - SHIP_LENGTH / 2 - 12)
    const ratio = Math.max(0, Math.min(1, health / maxHealth))
    const color = barColor === 'green' && ratio <= 0.3 ? 'red' : barColor
    const px = Math.round(HEALTH_BAR.fillX + HEALTH_BAR.fillWidth * ratio)
    if (px !== bar.lastPx || color !== bar.lastColor) {
      bar.lastPx = px
      bar.lastColor = color
      bar.fill.texture = this.fillTexture(color, px)
    }
  }

  private fillTexture(color: 'red' | 'green', px: number): Texture {
    const key = `${color}:${px}`
    let texture = this.fillTextures.get(key)
    if (!texture) {
      const base = this.textures.get(`enemy_health_fill_${color}`)
      texture = new Texture({
        source: base.source,
        frame: new Rectangle(0, 0, Math.max(1, px), HEALTH_BAR.height),
      })
      this.fillTextures.set(key, texture)
    }
    return texture
  }

  private disposeShip(view: ShipView): void {
    view.root.destroy({ children: true })
    view.bar.root.destroy({ children: true })
  }

  private releaseProjectile(sprite: Sprite): void {
    sprite.visible = false
    this.projectileLayer.removeChild(sprite)
    this.projectilePool.push(sprite)
  }

  /** Static island art: shallow halo, sand disc, grass core and a few deterministic props. */
  private buildIslands(islands: SimSnapshot['islands']): void {
    this.islandsBuilt = true
    islands.forEach((island, index) => {
      const random = mulberry(1000 + index * 97)
      const container = new Container()

      const halo = new Graphics()
        .circle(island.x, island.y, island.radius + 26)
        .fill({ color: 0xbff3ff, alpha: 0.28 })
        .circle(island.x, island.y, island.radius + 12)
        .fill({ color: 0xd8fbff, alpha: 0.3 })
      container.addChild(halo)

      const sand = this.tiledDisc('tile_68', island.x, island.y, island.radius)
      container.addChild(...sand)
      const grass = this.tiledDisc('tile_23', island.x, island.y, island.radius * 0.62)
      container.addChild(...grass)

      const props: [string, number, number][] = [
        ['tile_71', 0.0, 0.32],
        ['tile_70', 2.1, 0.4],
        ['tile_72', 4.0, 0.36],
        ['tile_50', 1.0, 0.86],
        ['tile_66', 3.3, 0.84],
        ['tile_49', 5.2, 0.88],
      ]
      for (const [name, base, dist] of props) {
        if (island.radius < 70 && dist < 0.5) continue
        const angle = base + random() * 0.8
        const sprite = new Sprite(this.textures.get(name))
        sprite.anchor.set(0.5)
        sprite.scale.set(0.8 + random() * 0.4)
        sprite.rotation = random() * Math.PI * 2
        sprite.position.set(
          island.x + Math.cos(angle) * island.radius * dist,
          island.y + Math.sin(angle) * island.radius * dist,
        )
        container.addChild(sprite)
      }
      this.islandLayer.addChild(container)
    })
  }

  /** A textured disc: a tiling sprite clipped by a circular mask. Returns [sprite, mask]. */
  private tiledDisc(
    texture: string,
    x: number,
    y: number,
    radius: number,
  ): [TilingSprite, Graphics] {
    const tiles = new TilingSprite({
      texture: this.textures.get(texture),
      width: radius * 2,
      height: radius * 2,
    })
    tiles.position.set(x - radius, y - radius)
    const mask = new Graphics().circle(x, y, radius).fill(0xffffff)
    tiles.mask = mask
    return [tiles, mask]
  }
}
