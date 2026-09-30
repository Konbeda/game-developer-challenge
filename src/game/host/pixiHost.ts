import { Application, Container, Graphics, type Ticker } from 'pixi.js'
import { DEFAULT_MATCH_CONFIG, type MatchResult } from '../../contracts/match.ts'
import { audio } from '../audio/audio.ts'
import { loadGameAssets } from '../assets/loader.ts'
import {
  ARENA,
  EMPTY_INPUT,
  FIXED_STEP_MS,
  INITIAL_HUD,
  type GameHost,
  type GameTestHook,
  type HudState,
  type InputState,
  type MatchPhase,
  type MatchSettings,
  type SimSnapshot,
  type Simulation,
} from '../contracts.ts'
import { GameScene } from '../render/scene.ts'
import { createSimulation } from '../sim/index.ts'
import { isPerfEnabled, PerfSampler } from './perf.ts'

/** Longest real frame the loop will catch up on, so a stalled tab cannot cause a spiral of steps. */
const MAX_FRAME_MS = 250
/** After the simulation ends, visuals keep animating this long before the UI is told (sinking, explosions). */
const END_NOTIFY_DELAY_MS = 1300
const MAX_RESOLUTION = 2

function randomSeed(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]!
}

/**
 * Pixi host: owns the canvas, the fixed-step loop and the scene. React talks to it only through
 * the `GameHost` interface; it never sees frames, only `HudState` changes.
 */
export class PixiGameHost implements GameHost {
  private app: Application | null = null
  private container: HTMLElement | null = null
  private world: Container | null = null
  private scene: GameScene | null = null
  private sim: Simulation | null = null
  private settings: MatchSettings | null = null
  private phase: MatchPhase = 'idle'
  private input: InputState = { ...EMPTY_INPUT }
  private accumulatorMs = 0
  private clockMode: 'realtime' | 'manual' = 'realtime'
  private hud: HudState = { ...INITIAL_HUD }
  private pendingResult: MatchResult | null = null
  private notifyInMs = 0
  private seedOverride: number | null = null
  private timeWarned = false
  private destroyed = false

  private readonly hudListeners = new Set<(hud: HudState) => void>()
  private readonly endListeners = new Set<(result: MatchResult, settings: MatchSettings) => void>()
  private resizeObserver: ResizeObserver | null = null
  private dprQuery: MediaQueryList | null = null
  private readonly onDprChange = () => {
    this.watchDpr()
    this.applyResolution()
    this.layout()
  }
  private readonly perf = isPerfEnabled() ? new PerfSampler() : null
  private testHook: GameTestHook | null = null

  constructor() {
    if (import.meta.env.VITE_E2E === 'true') this.installTestHook()
    if (this.perf) window.__perf = this.perf
  }

  // ---- GameHost ------------------------------------------------------------

  async mount(container: HTMLElement, onProgress?: (ratio: number) => void): Promise<void> {
    if (this.destroyed || this.app) return
    this.setPhase('loading')

    // Textures first: a failure leaves no half-built canvas behind and a retry starts clean.
    let textures
    try {
      textures = await loadGameAssets(onProgress)
    } catch (error) {
      if (!this.destroyed) this.setPhase('idle')
      throw error
    }
    if (this.destroyed) return

    const app = new Application()
    await app.init({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      background: 0x0a1a2e,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
    })
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true })
      return
    }

    this.app = app
    this.container = container
    app.canvas.setAttribute('role', 'img')
    app.canvas.setAttribute('aria-label', 'Pirate Battle arena')
    app.canvas.style.display = 'block'
    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.style.touchAction = 'none'
    container.appendChild(app.canvas)

    this.scene = new GameScene(textures, ARENA)
    this.world = new Container()
    const clip = new Graphics().rect(0, 0, ARENA.width, ARENA.height).fill(0xffffff)
    this.world.addChild(this.scene.root, clip)
    this.world.mask = clip
    app.stage.addChild(this.world)

    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(container)
    this.watchDpr()
    this.layout()

    // Idle preview so the arena is visible behind the loading/ready state.
    this.previewArena()
    this.setPhase('ready')

    app.ticker.add(this.onTick)
    if (this.clockMode === 'manual') app.ticker.stop()
    app.render()
  }

  start(settings: MatchSettings): void {
    if (!this.scene || this.destroyed) return
    const effective: MatchSettings =
      this.seedOverride === null ? settings : { ...settings, seed: this.seedOverride }
    this.seedOverride = null
    this.settings = effective
    this.sim = createSimulation(effective)
    this.scene.reset()
    this.input = { ...EMPTY_INPUT }
    this.accumulatorMs = 0
    this.pendingResult = null
    this.notifyInMs = 0
    this.phase = 'running'
    this.timeWarned = false
    audio.unlock()
    audio.stopAll()
    audio.startLoop('ocean_ambience_loop', 0.22)
    audio.play('game_start', 0.7)
    this.renderSnapshot(this.sim.snapshot())
    this.emitHud(true)
    this.app?.render()
  }

  pause(): void {
    if (this.phase !== 'running') return
    this.phase = 'paused'
    audio.stopAll()
    audio.play('game_pause', 0.6)
    this.input = { ...EMPTY_INPUT }
    this.accumulatorMs = 0
    this.emitHud(true)
  }

  resume(): void {
    if (this.phase !== 'paused') return
    // Nothing held during the pause carries over: the player must press again.
    this.input = { ...EMPTY_INPUT }
    this.accumulatorMs = 0
    this.phase = 'running'
    audio.startLoop('ocean_ambience_loop', 0.22)
    audio.play('game_resume', 0.6)
    this.emitHud(true)
  }

  restart(): void {
    if (!this.settings) return
    this.start({ config: this.settings.config, seed: randomSeed() })
  }

  setInput(partial: Partial<InputState>): void {
    if (this.phase !== 'running') return
    this.input = { ...this.input, ...partial }
  }

  subscribe(listener: (hud: HudState) => void): () => void {
    this.hudListeners.add(listener)
    listener(this.hud)
    return () => {
      this.hudListeners.delete(listener)
    }
  }

  onEnd(listener: (result: MatchResult, settings: MatchSettings) => void): () => void {
    this.endListeners.add(listener)
    return () => {
      this.endListeners.delete(listener)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.dprQuery?.removeEventListener('change', this.onDprChange)
    this.dprQuery = null
    if (this.app) {
      this.app.ticker.remove(this.onTick)
      this.app.ticker.stop()
    }
    audio.stopAll()
    this.scene?.destroy()
    this.scene = null
    this.world?.destroy({ children: true })
    this.world = null
    // Textures stay in the shared cache on purpose: the next match reuses them.
    this.app?.destroy({ removeView: true }, { children: true })
    this.app = null
    this.container = null
    this.sim = null
    this.hudListeners.clear()
    this.endListeners.clear()
    if (this.testHook && window.__game === this.testHook) delete window.__game
    if (this.perf && window.__perf === this.perf) delete window.__perf
    this.testHook = null
  }

  // ---- loop ------------------------------------------------------------------

  private readonly onTick = (ticker: Ticker): void => {
    if (this.clockMode === 'manual') return
    const frameMs = ticker.deltaMS
    this.advance(Math.min(frameMs, MAX_FRAME_MS), false)
    if (this.perf && this.phase === 'running') {
      const snap = this.sim?.snapshot()
      const entities = snap ? snap.enemies.length + snap.projectiles.length + 1 : 0
      this.perf.record(frameMs, entities + (this.scene?.effectCount ?? 0))
    }
  }

  /** One loop iteration: runs whole fixed steps for `dtMs`, then draws once. */
  private advance(dtMs: number, render: boolean): void {
    const scene = this.scene
    if (!scene) return

    if (this.phase === 'running' && this.sim) {
      this.accumulatorMs += dtMs
      while (this.accumulatorMs >= FIXED_STEP_MS && this.phase === 'running') {
        this.sim.step(this.input)
        const events = this.sim.drainEvents()
        scene.handleEvents(events)
        audio.handleEvents(events)
        this.accumulatorMs -= FIXED_STEP_MS
        const result = this.sim.result()
        if (result) this.finish(result)
      }
      this.renderSnapshot(this.sim.snapshot())
      scene.update(dtMs)
      this.emitHud(false)
      this.updateAmbience()
    } else if (this.phase === 'ended') {
      if (this.sim) this.renderSnapshot(this.sim.snapshot())
      scene.update(dtMs)
      if (this.pendingResult) {
        this.notifyInMs -= dtMs
        if (this.notifyInMs <= 0) this.notifyEnd()
      }
    } else if (this.phase === 'ready') {
      scene.update(dtMs)
    }
    if (render) this.app?.render()
  }

  /** Sailing loop follows the throttle; a warning cue plays once when 10 seconds remain. */
  private updateAmbience(): void {
    if (this.input.forward) audio.startLoop('ship_sailing_loop', 0.16)
    else audio.stopLoop('ship_sailing_loop')
    const seconds = this.settings?.config.sessionSeconds ?? 0
    if (!this.timeWarned && seconds > 10 && this.hud.timeRemainingMs <= 10_000) {
      this.timeWarned = true
      audio.play('time_warning', 0.7)
    }
  }

  private finish(result: MatchResult): void {
    this.pendingResult = result
    this.notifyInMs = END_NOTIFY_DELAY_MS
    this.phase = 'ended'
    this.input = { ...EMPTY_INPUT }
    this.emitHud(true)
  }

  private notifyEnd(): void {
    const result = this.pendingResult
    const settings = this.settings
    this.pendingResult = null
    if (!result || !settings) return
    for (const listener of [...this.endListeners]) listener(result, settings)
  }

  // ---- helpers ---------------------------------------------------------------

  private renderSnapshot(snapshot: SimSnapshot): void {
    this.scene?.sync(snapshot)
  }

  private previewArena(): void {
    const preview = createSimulation({ config: DEFAULT_MATCH_CONFIG, seed: 1 })
    this.renderSnapshot(preview.snapshot())
    this.scene?.update(0)
  }

  private setPhase(phase: MatchPhase): void {
    this.phase = phase
    this.emitHud(true)
  }

  /** Emits only when something React cares about changed (score, ~0.1s clock, health, phase). */
  private emitHud(force: boolean): void {
    const snap = this.sim?.snapshot()
    const next: HudState = { ...this.hud, phase: this.phase }
    if (snap && this.settings) {
      const remaining = Math.max(0, this.settings.config.sessionSeconds * 1000 - snap.timeMs)
      next.score = snap.score
      next.timeRemainingMs = Math.ceil(remaining / 100) * 100
      next.playerHealth = Math.max(0, Math.round(snap.player.health))
      next.playerMaxHealth = Math.round(snap.player.maxHealth)
    } else if (this.phase === 'idle') {
      Object.assign(next, INITIAL_HUD)
    }
    const h = this.hud
    const changed =
      next.phase !== h.phase ||
      next.score !== h.score ||
      next.timeRemainingMs !== h.timeRemainingMs ||
      next.playerHealth !== h.playerHealth ||
      next.playerMaxHealth !== h.playerMaxHealth
    if (!changed && !force) return
    this.hud = next
    for (const listener of [...this.hudListeners]) listener(next)
  }

  private layout(): void {
    const { app, container, world } = this
    if (!app || !container || !world) return
    const width = container.clientWidth
    const height = container.clientHeight
    if (width < 1 || height < 1) return
    app.renderer.resize(width, height)
    const scale = Math.min(width / ARENA.width, height / ARENA.height)
    world.scale.set(scale)
    world.position.set((width - ARENA.width * scale) / 2, (height - ARENA.height * scale) / 2)
    if (this.clockMode === 'manual' || this.phase !== 'running') app.render()
  }

  private applyResolution(): void {
    if (!this.app) return
    this.app.renderer.resolution = Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION)
  }

  /** Re-arms the one-shot media query that fires when devicePixelRatio changes (zoom, monitor move). */
  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange)
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    this.dprQuery.addEventListener('change', this.onDprChange, { once: true })
  }

  private installTestHook(): void {
    const params = new URLSearchParams(window.location.search)
    if (params.get('clock') === 'manual') this.clockMode = 'manual'
    const seed = Number(params.get('seed'))
    if (params.has('seed') && Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff) {
      this.seedOverride = seed
    }

    const hook: GameTestHook = {
      getSnapshot: () => this.sim?.snapshot() ?? null,
      getHud: () => this.hud,
      setClockMode: (mode) => {
        this.clockMode = mode
        this.accumulatorMs = 0
        if (mode === 'manual') this.app?.ticker.stop()
        else this.app?.ticker.start()
      },
      advance: (ms) => {
        if (!Number.isFinite(ms) || ms <= 0) return
        let left = ms
        const chunk = FIXED_STEP_MS * 6
        while (left > 0) {
          const dt = Math.min(left, chunk)
          this.advance(dt, false)
          left -= dt
        }
        this.app?.render()
      },
      setSeed: (value) => {
        if (Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff) this.seedOverride = value
      },
    }
    this.testHook = hook
    window.__game = hook
  }
}
