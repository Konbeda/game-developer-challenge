import type { MatchResult } from '../../contracts/match.ts'
import { EMPTY_INPUT, INITIAL_HUD } from '../contracts.ts'
import type { GameHost, HudState, InputState, MatchSettings } from '../contracts.ts'

/**
 * TEMPORARY FAKE HOST so the UI shell can run end to end. The real Pixi host replaces this
 * file (same export). The fake counts the clock down, ends the match when time is up and
 * lets `setInput(fireFront)` add points, so screens can be exercised.
 */
export function createGameHost(): GameHost {
  const hudListeners = new Set<(hud: HudState) => void>()
  const endListeners = new Set<(result: MatchResult, settings: MatchSettings) => void>()
  let hud: HudState = { ...INITIAL_HUD }
  let settings: MatchSettings | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let input: InputState = { ...EMPTY_INPUT }
  let destroyed = false

  const emit = (patch: Partial<HudState>) => {
    hud = { ...hud, ...patch }
    hudListeners.forEach((listener) => listener(hud))
  }
  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const finish = (endReason: MatchResult['endReason']) => {
    if (!settings) return
    stopTimer()
    const durationMs = settings.config.sessionSeconds * 1000 - hud.timeRemainingMs
    emit({ phase: 'ended' })
    const result: MatchResult = { score: hud.score, durationMs, endReason }
    endListeners.forEach((listener) => listener(result, settings!))
  }
  const run = () => {
    stopTimer()
    timer = setInterval(() => {
      if (input.fireFront && hud.score < 3) emit({ score: hud.score + 1 })
      const remaining = Math.max(0, hud.timeRemainingMs - 100)
      emit({ timeRemainingMs: remaining })
      if (remaining === 0) finish('time_up')
    }, 100)
  }

  return {
    async mount(_container, onProgress) {
      onProgress?.(1)
      emit({ phase: 'ready' })
    },
    start(next) {
      settings = next
      input = { ...EMPTY_INPUT }
      emit({
        phase: 'running',
        score: 0,
        timeRemainingMs: next.config.sessionSeconds * 1000,
        playerHealth: 100,
        playerMaxHealth: 100,
      })
      run()
    },
    pause() {
      if (hud.phase !== 'running') return
      stopTimer()
      input = { ...EMPTY_INPUT }
      emit({ phase: 'paused' })
    },
    resume() {
      if (hud.phase !== 'paused') return
      emit({ phase: 'running' })
      run()
    },
    restart() {
      if (settings) this.start(settings)
    },
    setInput(partial) {
      if (hud.phase === 'running') input = { ...input, ...partial }
    },
    subscribe(listener) {
      hudListeners.add(listener)
      listener(hud)
      return () => hudListeners.delete(listener)
    },
    onEnd(listener) {
      endListeners.add(listener)
      return () => endListeners.delete(listener)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      stopTimer()
      hudListeners.clear()
      endListeners.clear()
    },
  }
}
