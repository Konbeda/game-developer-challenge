import { useAppStore } from '../../state/appStore.ts'
import { useLastResultStore } from '../../state/lastResultStore.ts'
import { END_REASON_LABELS, formatDuration } from '../lib/format.ts'
import { Button, Panel, Scene, ScreenTitle } from '../primitives/index.ts'
import { enterGameFullscreen } from '../lib/fullscreen.ts'
import { SyncStatus } from './SyncStatus.tsx'

/** Shown right after a match ends. Play Again always uses the options that are current now. */
export function ResultScreen() {
  const startMatch = useAppStore((s) => s.startMatch)
  const playAgain = () => {
    enterGameFullscreen()
    startMatch()
  }
  const go = useAppStore((s) => s.go)
  const submission = useLastResultStore((s) => s.submission)
  const unrecorded = useLastResultStore((s) => s.unrecorded)

  const shown = unrecorded
    ? { ...unrecorded.result, matchId: null }
    : submission
      ? {
          score: submission.score,
          durationMs: submission.durationMs,
          endReason: submission.endReason,
          matchId: submission.matchId,
        }
      : null

  return (
    <Scene testId="screen-result" screen="result">
      <Panel className="w-[min(26rem,100%)] short:w-[min(36rem,100%)]" aria-label="Match result">
        <div className="skin-scroll flex min-h-0 flex-col items-center gap-3 overflow-y-auto px-1 text-center short:gap-1.5">
          <ScreenTitle testId="result-title" className="text-[1.75rem] short:text-[1.4rem]">
            {shown
              ? shown.endReason === 'time_up'
                ? 'Time is up'
                : 'Ship sunk'
              : 'Battle complete'}
          </ScreenTitle>

          {shown ? (
            <>
              <p
                className="font-display text-[4.2rem] leading-none font-semibold text-gold-bright title-shadow short:text-[2.6rem]"
                data-testid="result-score"
              >
                {shown.score}
              </p>
              <p className="text-sm font-bold tracking-widest text-cream uppercase">
                Points · <span data-testid="result-time">{formatDuration(shown.durationMs)}</span> ·{' '}
                <span data-testid="result-reason">{END_REASON_LABELS[shown.endReason]}</span>
              </p>
              {shown.matchId ? (
                <SyncStatus matchId={shown.matchId} testId="result-sync" />
              ) : (
                <p
                  role="status"
                  className="max-w-[34ch] text-sm text-danger"
                  data-testid="result-unrecorded"
                >
                  This match could not be recorded because its data was rejected.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted" data-testid="result-missing">
              No result to show yet.
            </p>
          )}

          <div className="flex flex-col items-center gap-2 short:flex-row short:gap-3">
            <Button onClick={playAgain} data-testid="result-play-again">
              Play again
            </Button>
            <Button onClick={() => go('menu')} data-testid="result-main-menu">
              Main menu
            </Button>
          </div>
        </div>
      </Panel>
    </Scene>
  )
}
