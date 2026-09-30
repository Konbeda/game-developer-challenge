import type { HudView } from './hudStore.ts'

/** Remaining-time milestones (seconds) announced when the clock crosses them. */
const MILESTONES = [10, 30, 60] as const

/**
 * What the polite live region should say for a change between two HUD views, or null when
 * nothing worth interrupting for happened. Pure and stateless: a milestone is announced when
 * the clock crosses it, so it can never repeat within one countdown.
 */
export function announcementFor(previous: HudView, next: HudView): string | null {
  if (previous.phase !== next.phase) {
    if (next.phase === 'running') return previous.phase === 'paused' ? 'Resumed.' : 'Match started.'
    if (next.phase === 'paused') return 'Paused.'
    if (next.phase === 'ended') return `Match over. Score ${next.score}.`
    return null
  }
  if (next.phase !== 'running' || next.seconds <= 0) return null
  for (const milestone of MILESTONES) {
    if (previous.seconds > milestone && next.seconds <= milestone) {
      return `${milestone} seconds remaining. Score ${next.score}.`
    }
  }
  return null
}
