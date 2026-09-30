import { useContext, useEffect, useState } from 'react'
import type { MatchPhase } from '../../game/contracts.ts'
import { formatCountdown, spokenDuration } from '../lib/format.ts'
import { announcementFor } from './announcements.ts'
import { HudStoreContext, useHud } from './hudStore.ts'

const PHASE_TEXT: Record<MatchPhase, string> = {
  idle: 'Not started',
  loading: 'Loading',
  ready: 'Ready',
  running: 'Playing',
  paused: 'Paused',
  ended: 'Match over',
}

/**
 * Semantic match status for assistive tech.
 *  - `hud-status`: current score, time, health and state as plain text. Not live, so it costs nothing
 *    to keep it up to date (the clock changes at most once per second).
 *  - `hud-live`: polite live region that only speaks on state changes (started, paused, resumed,
 *    over) and low-time milestones. Never per frame, never per second.
 */
export function SrStatus() {
  const store = useContext(HudStoreContext)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (!store) return
    let previous = store.getState()
    return store.subscribe((next) => {
      const text = announcementFor(previous, next)
      previous = next
      if (text) setAnnouncement(text)
    })
  }, [store])

  return (
    <div className="sr-only">
      <Status />
      <p role="status" aria-live="polite" aria-atomic="true" data-testid="hud-live">
        {announcement}
      </p>
    </div>
  )
}

function Status() {
  const phase = useHud((v) => v.phase)
  const score = useHud((v) => v.score)
  const seconds = useHud((v) => v.seconds)
  const health = useHud((v) => v.health)
  const maxHealth = useHud((v) => v.maxHealth)
  return (
    <section aria-label="Match status" data-testid="hud-status">
      <p>
        State: <span data-testid="hud-status-state">{PHASE_TEXT[phase]}</span>. Score:{' '}
        <span data-testid="hud-status-score">{score}</span>. Time remaining:{' '}
        <span data-testid="hud-status-time" data-clock={formatCountdown(seconds * 1000)}>
          {spokenDuration(seconds * 1000)}
        </span>
        . Ship health: {health} of {maxHealth}.
      </p>
    </section>
  )
}
