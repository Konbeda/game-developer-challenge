import { useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { InputState } from '../../game/contracts.ts'
import { useAppStore } from '../../state/appStore.ts'
import { usePortraitPhone, useTouchControls } from '../lib/media.ts'
import {
  Button,
  ErrorState,
  Panel,
  ProgressBar,
  ScreenTitle,
  useModalOpen,
} from '../primitives/index.ts'
import { Hud } from './Hud.tsx'
import { HudStoreContext } from './hudStore.ts'
import { PauseDialog } from './PauseDialog.tsx'
import { SrStatus } from './SrStatus.tsx'
import { TouchControls } from './TouchControls.tsx'
import { useGameKeyboard } from './useGameKeyboard.ts'
import { useGameSession } from './useGameSession.ts'

type PauseReason = 'manual' | 'auto'

/**
 * Match screen: a letterboxed 16:9 stage that hosts the Pixi canvas, with the React HUD, touch
 * controls, pause dialog and a semantic status region on top. The host is created and destroyed
 * by `useGameSession`; leaving this screen abandons the match (nothing is recorded).
 */
export function GameScreen() {
  const { containerRef, hostRef, hudStore, load, retry } = useGameSession()
  const go = useAppStore((s) => s.go)
  const touch = useTouchControls()
  const portrait = usePortraitPhone()
  const modalOpen = useModalOpen()
  const phase = useStore(hudStore, (view) => view.phase)
  const [pauseReason, setPauseReason] = useState<PauseReason>('manual')

  const pause = useCallback(
    (reason: PauseReason) => {
      const host = hostRef.current
      if (!host || hudStore.getState().phase !== 'running') return
      setPauseReason(reason)
      host.pause()
    },
    [hostRef, hudStore],
  )
  const pauseManually = useCallback(() => pause('manual'), [pause])
  const resume = useCallback(() => hostRef.current?.resume(), [hostRef])
  const restart = useCallback(() => hostRef.current?.restart(), [hostRef])
  const leave = useCallback(() => go('menu'), [go])

  // Losing focus, hiding the tab or turning the phone upright pauses; resuming needs a click.
  useEffect(() => {
    const onBlur = () => pause('auto')
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause('auto')
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pause])

  useEffect(() => {
    if (portrait) pause('auto')
  }, [portrait, pause])

  const playing = load.status === 'ready' && phase === 'running' && !modalOpen
  useGameKeyboard(hostRef, playing, pauseManually)

  const hold = useCallback(
    (action: keyof InputState, held: boolean) => hostRef.current?.setInput({ [action]: held }),
    [hostRef],
  )

  return (
    <main className="game-viewport" data-testid="screen-game" data-screen="game" data-phase={phase}>
      <ScreenTitle testId="game-title" className="sr-only">
        Pirate Battle match
      </ScreenTitle>
      <HudStoreContext.Provider value={hudStore}>
        <div className="game-stage" data-testid="game-stage">
          <div ref={containerRef} className="game-canvas-host" data-testid="game-canvas-host" />

          {load.status === 'ready' ? <Hud onPause={pauseManually} /> : null}
          {load.status === 'ready' && touch ? (
            <TouchControls enabled={playing} onHold={hold} />
          ) : null}

          {load.status === 'loading' ? (
            <div className="absolute inset-0 grid place-items-center p-2">
              <Panel className="w-[min(22rem,100%)]" aria-label="Loading">
                <div
                  role="status"
                  data-testid="game-loading"
                  className="flex flex-col items-center gap-3 px-1 text-center"
                >
                  <p className="font-display text-xl font-semibold tracking-wide text-cream uppercase">
                    Loading the battle
                  </p>
                  <ProgressBar value={load.progress} label="Loading game assets" />
                  <p className="text-sm text-cream-dim" data-testid="game-loading-percent">
                    {Math.round(load.progress * 100)}%
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={leave}
                    data-testid="game-loading-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              </Panel>
            </div>
          ) : null}

          {load.status === 'error' ? (
            <div className="absolute inset-0 grid place-items-center p-2">
              <Panel className="w-[min(24rem,100%)]" aria-label="Loading failed">
                <div className="flex flex-col items-center gap-3 px-1">
                  <ErrorState
                    testId="game-error"
                    title="Could not load the game"
                    message={load.message}
                    onRetry={retry}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={leave}
                    data-testid="game-error-menu"
                  >
                    Main menu
                  </Button>
                </div>
              </Panel>
            </div>
          ) : null}
        </div>

        <SrStatus />

        {phase === 'paused' ? (
          <PauseDialog
            escapeResumes={pauseReason === 'manual'}
            touch={touch}
            onResume={resume}
            onRestart={restart}
            onMainMenu={leave}
          />
        ) : null}
      </HudStoreContext.Provider>
    </main>
  )
}
