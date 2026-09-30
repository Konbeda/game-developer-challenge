import { memo } from 'react'
import type { CSSProperties } from 'react'
import { formatCountdown } from '../lib/format.ts'
import { Icon, IconButton } from '../primitives/index.ts'
import { useHud } from './hudStore.ts'
import { SoundToggle } from './SoundToggle.tsx'

const HealthBar = memo(function HealthBar() {
  const health = useHud((v) => v.health)
  const maxHealth = useHud((v) => v.maxHealth)
  const ratio = maxHealth > 0 ? Math.min(1, Math.max(0, health / maxHealth)) : 0
  const fill = ratio > 0.5 ? 'green' : ratio > 0.25 ? 'amber' : 'red'
  return (
    <div
      className="hud-health"
      style={{ left: 'calc(46 * var(--hud))', top: 'calc(14 * var(--hud))' }}
      data-testid="hud-health"
      data-health={health}
      data-max-health={maxHealth}
      aria-hidden="true"
    >
      <div
        className="hud-health__fill"
        style={
          {
            '--ratio': ratio,
            backgroundImage: `var(--skin-health-fill-${fill})`,
          } as CSSProperties
        }
      />
      <div className="hud-health__label">
        <span>
          {health} / {maxHealth}
        </span>
      </div>
      <Icon
        name="heart"
        className="absolute"
        style={{
          left: 'calc(-38 * var(--hud))',
          top: 'calc(1 * var(--hud))',
          width: 'calc(44 * var(--hud))',
          height: 'calc(44 * var(--hud))',
        }}
      />
    </div>
  )
})

const ScoreCounter = memo(function ScoreCounter() {
  const score = useHud((v) => v.score)
  return (
    <div className="hud-counter" data-testid="hud-score-panel" aria-hidden="true">
      <Icon name="score" />
      <span data-testid="hud-score">{score}</span>
    </div>
  )
})

const TimeCounter = memo(function TimeCounter() {
  const seconds = useHud((v) => v.seconds)
  return (
    <div className="hud-counter" data-testid="hud-time-panel" aria-hidden="true">
      <Icon name="time" />
      <span data-testid="hud-time">{formatCountdown(seconds * 1000)}</span>
    </div>
  )
})

interface HudProps {
  onPause: () => void
}

/**
 * Sprite HUD laid out like the design: health top-left, score / timer / pause top-right.
 * Each piece subscribes to its own slice so nothing re-renders per frame.
 */
export const Hud = memo(function Hud({ onPause }: HudProps) {
  const phase = useHud((v) => v.phase)
  return (
    <div className="hud-layer" data-testid="hud">
      <HealthBar />
      <div
        className="flex items-center"
        style={{
          right: 'calc(14 * var(--hud))',
          top: 'calc(10 * var(--hud))',
          gap: 'calc(12 * var(--hud))',
        }}
      >
        <ScoreCounter />
        <TimeCounter />
        <SoundToggle
          className="hud-interactive"
          style={{ '--round': 'calc(56 * var(--hud) * 1.05)' } as CSSProperties}
        />
        <IconButton
          icon="pause"
          label="Pause"
          className="hud-interactive"
          style={{ '--round': 'calc(56 * var(--hud) * 1.05)' } as CSSProperties}
          disabled={phase !== 'running'}
          onClick={onPause}
          data-testid="hud-pause"
        />
      </div>
    </div>
  )
})
