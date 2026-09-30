import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { GameHost } from '../../game/contracts.ts'
import { createGameHost } from '../../game/host/index.ts'
import { useOptionsStore } from '../../state/optionsStore.ts'
import { createSeed } from '../../state/ids.ts'
import { completeMatch } from './completeMatch.ts'
import { applyHud, createHudStore } from './hudStore.ts'
import type { HudStore } from './hudStore.ts'

export type LoadState =
  | { status: 'loading'; progress: number }
  | { status: 'error'; message: string }
  | { status: 'ready' }

export interface GameSession {
  containerRef: RefObject<HTMLDivElement | null>
  hostRef: RefObject<GameHost | null>
  hudStore: HudStore
  load: LoadState
  /** Re-runs `mount` on the same host after a failure. */
  retry: () => void
}

/**
 * Owns the GameHost for one mounted game screen: created in an effect, destroyed in its cleanup
 * (exactly once per host, also under Strict Mode's double mount). It mounts with visible
 * progress, starts the match with a snapshot of the current options and a fresh random seed,
 * mirrors HudState into a store and forwards the end of the match to `completeMatch`.
 */
export function useGameSession(): GameSession {
  const containerRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<GameHost | null>(null)
  const retryRef = useRef<() => void>(() => {})
  const [hudStore] = useState(createHudStore)
  const [load, setLoad] = useState<LoadState>({ status: 'loading', progress: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const host = createGameHost()
    hostRef.current = host
    let alive = true

    const offHud = host.subscribe((hud) => applyHud(hudStore, hud))
    const offEnd = host.onEnd((result, settings) => {
      if (alive) completeMatch(result, settings)
    })

    const mount = () => {
      setLoad({ status: 'loading', progress: 0 })
      host
        .mount(container, (ratio) => {
          if (alive)
            setLoad((state) =>
              state.status === 'loading' ? { status: 'loading', progress: ratio } : state,
            )
        })
        .then(() => {
          if (!alive) return
          setLoad({ status: 'ready' })
          // Each match runs on a snapshot of the options as they are right now.
          host.start({ config: useOptionsStore.getState().config, seed: createSeed() })
        })
        .catch((error: unknown) => {
          if (!alive) return
          setLoad({
            status: 'error',
            message:
              error instanceof Error && error.message
                ? error.message
                : 'The game assets could not be loaded.',
          })
        })
    }
    retryRef.current = mount
    mount()

    return () => {
      alive = false
      retryRef.current = () => {}
      offHud()
      offEnd()
      host.destroy()
      if (hostRef.current === host) hostRef.current = null
    }
  }, [hudStore])

  const retry = useCallback(() => retryRef.current(), [])
  return { containerRef, hostRef, hudStore, load, retry }
}
