import type { EndReason } from '../../contracts/match.ts'

/** Presentation helpers (pure, unit tested). */

/** "mm:ss" from milliseconds, rounding down: 102_000 -> "01:42". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return clock(totalSeconds)
}

/** Countdown clock: rounds UP so the display reaches 00:00 only when time is really over. */
export function formatCountdown(ms: number): string {
  return clock(Math.max(0, Math.ceil(ms / 1000)))
}

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const END_REASON_LABELS: Record<EndReason, string> = {
  time_up: 'Time up',
  player_destroyed: 'Defeated',
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** "08 SEP · 21:42" in the viewer's local time, e.g. for `<time>` elements. */
export function formatPlayed(iso: string, timeZone?: 'UTC'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  const utc = timeZone === 'UTC'
  const day = String(utc ? date.getUTCDate() : date.getDate()).padStart(2, '0')
  const month = MONTHS[utc ? date.getUTCMonth() : date.getMonth()] ?? ''
  const hours = String(utc ? date.getUTCHours() : date.getHours()).padStart(2, '0')
  const minutes = String(utc ? date.getUTCMinutes() : date.getMinutes()).padStart(2, '0')
  return `${day} ${month} · ${hours}:${minutes}`
}

export function formatRank(rank: number): string {
  return String(rank).padStart(2, '0')
}

/** Screen-reader friendly countdown: "1 minute 42 seconds". */
export function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  if (seconds > 0 || parts.length === 0)
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`)
  return parts.join(' ')
}
