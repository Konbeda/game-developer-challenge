import { describe, expect, it } from 'vitest'
import { announcementFor } from './announcements.ts'
import type { HudView } from './hudStore.ts'

const view = (patch: Partial<HudView>): HudView => ({
  phase: 'running',
  score: 0,
  seconds: 90,
  health: 100,
  maxHealth: 100,
  ...patch,
})

describe('announcementFor', () => {
  it('announces state changes', () => {
    expect(announcementFor(view({ phase: 'ready' }), view({ phase: 'running' }))).toBe(
      'Match started.',
    )
    expect(announcementFor(view({}), view({ phase: 'paused' }))).toBe('Paused.')
    expect(announcementFor(view({ phase: 'paused' }), view({ phase: 'running' }))).toBe('Resumed.')
    expect(announcementFor(view({ score: 7 }), view({ phase: 'ended', score: 7 }))).toBe(
      'Match over. Score 7.',
    )
  })

  it('stays quiet for score and per-second clock changes', () => {
    expect(announcementFor(view({ seconds: 80 }), view({ seconds: 79 }))).toBeNull()
    expect(announcementFor(view({ score: 1 }), view({ score: 2 }))).toBeNull()
  })

  it('announces low-time milestones once when the clock crosses them', () => {
    expect(announcementFor(view({ seconds: 31 }), view({ seconds: 30, score: 4 }))).toBe(
      '30 seconds remaining. Score 4.',
    )
    expect(announcementFor(view({ seconds: 30 }), view({ seconds: 29 }))).toBeNull()
    expect(announcementFor(view({ seconds: 11 }), view({ seconds: 10 }))).toBe(
      '10 seconds remaining. Score 0.',
    )
    expect(announcementFor(view({ seconds: 61 }), view({ seconds: 60 }))).toBe(
      '60 seconds remaining. Score 0.',
    )
  })

  it('does not announce milestones while paused or at the start of a match', () => {
    expect(
      announcementFor(
        view({ phase: 'paused', seconds: 31 }),
        view({ phase: 'paused', seconds: 30 }),
      ),
    ).toBeNull()
    expect(
      announcementFor(view({ phase: 'idle', seconds: 0 }), view({ phase: 'idle', seconds: 60 })),
    ).toBeNull()
  })
})
