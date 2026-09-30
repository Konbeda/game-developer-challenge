import { Container, Sprite, type Texture } from 'pixi.js'
import type { GameTextures } from '../assets/loader.ts'
import { shipTextureName, type ShipColor } from '../assets/manifest.ts'

/** Deterministic PRNG for visual jitter only (never used by the simulation). */
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

interface Effect {
  sprite: Sprite
  age: number
  life: number
  /** Called every frame with progress 0..1; may mutate the sprite. */
  step(progress: number, dtMs: number): void
}

const MAX_EFFECTS = 90

/**
 * Short-lived visual feedback: muzzle flashes, impacts, explosions, sinking wrecks, debris.
 * Sprites are pooled, and animation advances with the simulated clock so a manual test clock
 * produces identical frames.
 */
export class EffectSystem {
  readonly layer = new Container()
  private readonly active: Effect[] = []
  private readonly pool: Sprite[] = []
  private readonly random = mulberry(0x5eed)

  private readonly textures: GameTextures

  constructor(textures: GameTextures) {
    this.textures = textures
  }

  get count(): number {
    return this.active.length
  }

  update(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!
      effect.age += dtMs
      const progress = Math.min(1, effect.age / effect.life)
      effect.step(progress, dtMs)
      if (progress >= 1) {
        this.release(effect.sprite)
        this.active[i] = this.active[this.active.length - 1]!
        this.active.pop()
      }
    }
  }

  clear(): void {
    for (const effect of this.active) this.release(effect.sprite)
    this.active.length = 0
  }

  destroy(): void {
    this.clear()
    this.layer.destroy({ children: true })
    this.pool.length = 0
  }

  private acquire(texture: Texture): Sprite | null {
    if (this.active.length >= MAX_EFFECTS) return null
    const sprite = this.pool.pop() ?? new Sprite()
    sprite.texture = texture
    sprite.anchor.set(0.5)
    sprite.alpha = 1
    sprite.tint = 0xffffff
    sprite.rotation = 0
    sprite.scale.set(1)
    sprite.visible = true
    this.layer.addChild(sprite)
    return sprite
  }

  private release(sprite: Sprite): void {
    sprite.visible = false
    this.layer.removeChild(sprite)
    this.pool.push(sprite)
  }

  private add(sprite: Sprite | null, life: number, step: Effect['step']): void {
    if (sprite) this.active.push({ sprite, age: 0, life, step })
  }

  /** Expanding fireball: small -> medium -> large frames, fading at the end. */
  explosion(x: number, y: number, big: boolean): void {
    const frames = ['explosion_3', 'explosion_2', 'explosion_1'].map((n) => this.textures.get(n))
    const sprite = this.acquire(frames[0]!)
    if (!sprite) return
    sprite.position.set(x, y)
    const base = big ? 1.9 : 1.1
    const life = big ? 650 : 420
    this.add(sprite, life, (p) => {
      sprite.texture = frames[Math.min(2, Math.floor(p * 3))]!
      sprite.scale.set(base * (0.6 + p * 0.8))
      sprite.alpha = p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35
    })
  }

  muzzleFlash(x: number, y: number): void {
    const sprite = this.acquire(this.textures.get('explosion_3'))
    if (!sprite) return
    sprite.position.set(x, y)
    sprite.tint = 0xffe6a0
    this.add(sprite, 140, (p) => {
      sprite.scale.set(0.55 + p * 0.35)
      sprite.alpha = 1 - p
    })
  }

  /** Small puff where a shell hits something. */
  impact(x: number, y: number, tint: number): void {
    const sprite = this.acquire(this.textures.get('explosion_3'))
    if (!sprite) return
    sprite.position.set(x, y)
    sprite.tint = tint
    this.add(sprite, 260, (p) => {
      sprite.scale.set(0.45 + p * 0.5)
      sprite.alpha = 1 - p
    })
  }

  /** A destroyed ship sinks: the wreck sprite drifts, shrinks and fades. */
  wreck(x: number, y: number, angle: number, color: ShipColor, scale: number): void {
    const sprite = this.acquire(this.textures.get(shipTextureName(color, 3)))
    if (!sprite) return
    sprite.position.set(x, y)
    sprite.rotation = angle - Math.PI / 2
    const drift = (this.random() - 0.5) * 14
    this.add(sprite, 1700, (p) => {
      sprite.scale.set(scale * (1 - p * 0.18))
      sprite.alpha = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65
      sprite.rotation += drift * 0.00003 * 16
    })
  }

  /** Wood planks flung outwards when a ship breaks up. */
  debris(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      const sprite = this.acquire(this.textures.get(`wood_${1 + Math.floor(this.random() * 4)}`))
      if (!sprite) return
      sprite.position.set(x, y)
      const dir = this.random() * Math.PI * 2
      const speed = 50 + this.random() * 110
      const spin = (this.random() - 0.5) * 0.02
      this.add(sprite, 900 + this.random() * 500, (p, dt) => {
        sprite.x += Math.cos(dir) * speed * (dt / 1000) * (1 - p)
        sprite.y += Math.sin(dir) * speed * (dt / 1000) * (1 - p)
        sprite.rotation += spin * dt
        sprite.alpha = 1 - p * p
      })
    }
  }
}
