import { z } from 'zod'
import { readStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage.ts'
import type { SimEvent } from '../contracts.ts'

const ROOT = '/assets/sounds'

const SOUND_FILES = [
  'cannon_fire_1',
  'cannon_fire_2',
  'cannon_fire_3',
  'cannon_broadside',
  'cannonball_water_hit_1',
  'cannonball_water_hit_2',
  'ship_wood_hit_1',
  'ship_wood_hit_2',
  'ship_explosion_1',
  'ship_explosion_2',
  'ship_collision',
  'ship_sinking',
  'score_point',
  'game_start',
  'game_complete',
  'game_over',
  'game_pause',
  'game_resume',
  'health_low',
  'time_warning',
  'ocean_ambience_loop',
  'ship_sailing_loop',
  'ui_click',
  'ui_hover',
  'ui_back',
  'ui_open',
  'ui_close',
] as const

export type SoundName = (typeof SOUND_FILES)[number]

/** Sounds that may not restart sooner than this (ms), so broadsides and volleys do not stack into noise. */
const MIN_GAP_MS = 55

interface Loop {
  source: AudioBufferSourceNode
  gain: GainNode
}

/**
 * Small Web Audio wrapper. Everything is best effort: no audio device, blocked autoplay or a failed
 * download never throws or logs; the game simply stays silent.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private readonly raw = new Map<SoundName, Promise<ArrayBuffer | null>>()
  private readonly buffers = new Map<SoundName, AudioBuffer>()
  private readonly loops = new Map<SoundName, Loop>()
  private readonly lastPlayed = new Map<SoundName, number>()
  private muted = readStorage(STORAGE_KEYS.muted, z.boolean(), false)
  private pick = 0
  private lowHealthAt = 0

  isMuted(): boolean {
    return this.muted
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    writeStorage(STORAGE_KEYS.muted, muted)
    if (this.master) this.master.gain.value = muted ? 0 : 1
  }

  /** Starts downloading the files (no audio context needed yet). Safe to call repeatedly. */
  preload(): void {
    for (const name of SOUND_FILES) {
      if (this.raw.has(name)) continue
      this.raw.set(
        name,
        fetch(`${ROOT}/${name}.wav`)
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .catch(() => null),
      )
    }
  }

  /** Creates/resumes the audio context. Call from (or after) a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 1
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined)
      this.preload()
    } catch {
      this.ctx = null
    }
  }

  private async buffer(name: SoundName): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(name)
    if (cached) return cached
    const ctx = this.ctx
    const data = await this.raw.get(name)
    if (!ctx || !data) return null
    try {
      // decodeAudioData detaches its input, so decode a copy and keep the original reusable.
      const decoded = await ctx.decodeAudioData(data.slice(0))
      this.buffers.set(name, decoded)
      return decoded
    } catch {
      return null
    }
  }

  play(name: SoundName, volume = 1, rate = 1): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return
    const now = performance.now()
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS) return
    this.lastPlayed.set(name, now)
    void this.buffer(name).then((buffer) => {
      if (!buffer || !this.ctx || !this.master) return
      const source = this.ctx.createBufferSource()
      const gain = this.ctx.createGain()
      source.buffer = buffer
      source.playbackRate.value = rate
      gain.gain.value = volume
      source.connect(gain).connect(this.master)
      source.start()
    })
  }

  startLoop(name: SoundName, volume: number): void {
    const existing = this.loops.get(name)
    if (existing) {
      existing.gain.gain.value = volume
      return
    }
    const ctx = this.ctx
    if (!ctx || !this.master) return
    // Reserve the slot synchronously so concurrent calls do not start two loops.
    const gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(this.master)
    const source = ctx.createBufferSource()
    source.loop = true
    const loop: Loop = { source, gain }
    this.loops.set(name, loop)
    void this.buffer(name).then((buffer) => {
      if (!buffer || this.loops.get(name) !== loop) return
      source.buffer = buffer
      source.connect(gain)
      source.start()
    })
  }

  stopLoop(name: SoundName): void {
    const loop = this.loops.get(name)
    if (!loop) return
    this.loops.delete(name)
    try {
      loop.source.stop()
    } catch {
      // never started
    }
    loop.source.disconnect()
    loop.gain.disconnect()
  }

  stopAll(): void {
    for (const name of [...this.loops.keys()]) this.stopLoop(name)
  }

  /** Maps simulation events to sounds. */
  handleEvents(events: readonly SimEvent[]): void {
    const playerShots = events.filter((e) => e.type === 'shot' && e.owner === 'player').length
    let playedBroadside = false
    for (const event of events) {
      switch (event.type) {
        case 'shot':
          if (event.owner === 'player') {
            if (playerShots >= 2) {
              if (!playedBroadside) this.play('cannon_broadside', 0.8)
              playedBroadside = true
            } else {
              this.play(`cannon_fire_${(this.pick++ % 3) + 1}` as SoundName, 0.55)
            }
          } else {
            this.play(`cannon_fire_${(this.pick++ % 3) + 1}` as SoundName, 0.3, 0.85)
          }
          break
        case 'hit':
          if (event.target === 'island') {
            this.play(`cannonball_water_hit_${(this.pick++ % 2) + 1}` as SoundName, 0.5)
          } else {
            this.play(`ship_wood_hit_${(this.pick++ % 2) + 1}` as SoundName, 0.6)
          }
          break
        case 'explosion':
          this.play(`ship_explosion_${(this.pick++ % 2) + 1}` as SoundName, event.big ? 0.8 : 0.55)
          break
        case 'enemy_destroyed':
          if (event.byPlayer) this.play('score_point', 0.6)
          break
        case 'player_damaged': {
          this.play('ship_collision', 0.5)
          const now = performance.now()
          if (event.health <= 30 && now - this.lowHealthAt > 4000) {
            this.lowHealthAt = now
            this.play('health_low', 0.6)
          }
          break
        }
        case 'match_end':
          this.stopAll()
          if (event.result.endReason === 'time_up') {
            this.play('game_complete', 0.8)
          } else {
            this.play('ship_sinking', 0.8)
            this.play('game_over', 0.7)
          }
          break
      }
    }
  }
}

/** Shared instance: sounds and the mute preference survive across matches. */
export const audio = new AudioEngine()
