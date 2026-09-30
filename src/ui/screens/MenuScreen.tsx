import { useAppStore } from '../../state/appStore.ts'
import { useLastResultStore } from '../../state/lastResultStore.ts'
import { usePlayerStore } from '../../state/playerStore.ts'
import { ControlsList } from '../game/ControlsList.tsx'
import { SoundToggle } from '../game/SoundToggle.tsx'
import { useMediaQuery } from '../lib/media.ts'
import { END_REASON_LABELS, formatDuration, formatPlayed } from '../lib/format.ts'
import { Button, LinkButton, Panel, Scene, ScreenTitle } from '../primitives/index.ts'
import { skinEmblemUrl, skinTitleUrl } from '../skin.ts'
import { NetworkScenariosTrigger } from './NetworkScenarios.tsx'
import { SyncStatus } from './SyncStatus.tsx'

export function MenuScreen() {
  const startMatch = useAppStore((s) => s.startMatch)
  const go = useAppStore((s) => s.go)
  const openLog = useAppStore((s) => s.openLog)
  // Short landscape phones: the captain card moves under the buttons so the right column fits.
  const short = useMediaQuery('(max-height: 460px)')

  return (
    <Scene testId="screen-menu" screen="menu">
      <Panel className="w-[min(50rem,100%)] short:w-[min(58rem,100%)]" aria-label="Main menu">
        <div className="skin-scroll flex min-h-0 flex-col items-center gap-3 overflow-y-auto px-1 short:gap-1.5">
          <ScreenTitle
            testId="menu-title"
            className="w-[min(20rem,72%)] shrink-0 short:w-[10.5rem]"
          >
            <img
              src={skinTitleUrl()}
              alt="Pirate Battle"
              className="block w-full"
              draggable={false}
            />
          </ScreenTitle>

          <div className="grid w-full gap-4 sm:grid-cols-[minmax(18rem,1fr)_1.25fr] sm:items-start short:gap-3">
            <div className="flex flex-col items-center gap-3 short:gap-2">
              <nav aria-label="Main" className="flex flex-col items-center gap-3 short:gap-2">
                <p className="text-[0.7rem] font-bold tracking-[0.28em] text-cream uppercase">
                  Set sail. Take command.
                </p>
                <Button
                  size="lg"
                  onClick={startMatch}
                  data-testid="menu-play"
                  className="w-full max-w-[16rem]"
                >
                  Play
                </Button>
                <Button
                  size="lg"
                  onClick={() => go('options')}
                  data-testid="menu-options"
                  className="w-full max-w-[16rem]"
                >
                  Options
                </Button>
                <img
                  src={skinEmblemUrl()}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="my-1 h-11 w-auto short:hidden"
                />
                <p className="text-center text-xs text-cream short:hidden">
                  Navigate the islands. Survive the battle.
                </p>
                <div className="flex flex-nowrap items-center justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openLog('ranking')}
                    data-testid="menu-ranking"
                  >
                    Ranking
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openLog('history')}
                    data-testid="menu-history"
                  >
                    Match History
                  </Button>
                </div>
              </nav>
              {short ? <CaptainCard /> : null}
            </div>

            <div className="flex flex-col gap-3 short:gap-1.5">
              {short ? null : <CaptainCard />}
              <LastMatchCard />
              <ControlsList />
            </div>
          </div>
        </div>
      </Panel>
      <div className="absolute right-2 bottom-1.5">
        <SoundToggle size="sm" />
      </div>
      <div className="absolute bottom-1.5 left-2 rounded-chip bg-[rgba(8,16,30,0.72)]">
        <NetworkScenariosTrigger look="link" />
      </div>
      <p
        className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-chip bg-[rgba(8,16,30,0.72)] px-2 py-0.5 text-[0.65rem] text-cream-dim"
        data-testid="build-id"
      >
        Build {__BUILD_ID__}
      </p>
    </Scene>
  )
}

function CaptainCard() {
  const name = usePlayerStore((s) => s.playerName)
  const openNameDialog = useAppStore((s) => s.openNameDialog)
  return (
    <section
      aria-label="Captain"
      className="flex items-center justify-between gap-2 rounded-field bg-board-deep/60 px-3 py-2"
    >
      <p className="min-w-0 text-sm">
        <span className="block text-[0.66rem] font-bold tracking-widest text-muted uppercase">
          Captain
        </span>
        <span
          className="block truncate font-display text-lg font-semibold text-gold-bright"
          data-testid="player-name"
        >
          {name}
        </span>
      </p>
      <LinkButton onClick={() => openNameDialog('edit')} data-testid="change-name">
        Change name
      </LinkButton>
    </section>
  )
}

function LastMatchCard() {
  const submission = useLastResultStore((s) => s.submission)
  return (
    <section
      aria-labelledby="last-match-title"
      data-testid="last-match"
      className="rounded-field bg-board-deep/60 px-3 py-2"
    >
      <h2
        id="last-match-title"
        className="text-[0.66rem] font-bold tracking-widest text-muted uppercase"
      >
        Last match
      </h2>
      {submission ? (
        <div className="mt-1 flex flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span
              className="font-display text-xl font-semibold text-gold-bright"
              data-testid="last-match-score"
            >
              {submission.score}
            </span>
            <span className="text-cream-dim">
              points ·{' '}
              <span data-testid="last-match-time">{formatDuration(submission.durationMs)}</span> ·{' '}
              <span data-testid="last-match-reason">{END_REASON_LABELS[submission.endReason]}</span>
            </span>
          </p>
          <p className="text-xs text-muted">
            <time dateTime={submission.playedAt}>{formatPlayed(submission.playedAt)}</time>
          </p>
          <SyncStatus matchId={submission.matchId} testId="last-match-sync" compact align="start" />
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted" data-testid="last-match-empty">
          No battles yet. Your latest result will show up here.
        </p>
      )}
    </section>
  )
}
