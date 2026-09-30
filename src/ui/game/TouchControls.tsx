import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { InputState } from '../../game/contracts.ts'
import { IconButton } from '../primitives/index.ts'
import type { SkinIconName } from '../skin.ts'

interface TouchButtonDef {
  action: keyof InputState
  icon: SkinIconName
  label: string
  testId: string
  /** Offsets inside the cluster, in units of one button (see .touch-controls). */
  x: number
  y: number
}

const MOVE_BUTTONS: readonly TouchButtonDef[] = [
  {
    action: 'turnLeft',
    icon: 'turnLeft',
    label: 'Turn left',
    testId: 'touch-turn-left',
    x: 0,
    y: 0.62,
  },
  {
    action: 'forward',
    icon: 'forward',
    label: 'Sail forward',
    testId: 'touch-forward',
    x: 1.18,
    y: 0,
  },
  {
    action: 'turnRight',
    icon: 'turnRight',
    label: 'Turn right',
    testId: 'touch-turn-right',
    x: 2.36,
    y: 0.62,
  },
]

const FIRE_BUTTONS: readonly TouchButtonDef[] = [
  {
    action: 'fireLeft',
    icon: 'fireLeft',
    label: 'Fire left broadside',
    testId: 'touch-fire-left',
    x: 0,
    y: 0.62,
  },
  {
    action: 'fireFront',
    icon: 'fireFront',
    label: 'Fire front cannon',
    testId: 'touch-fire-front',
    x: 1.18,
    y: 0,
  },
  {
    action: 'fireRight',
    icon: 'fireRight',
    label: 'Fire right broadside',
    testId: 'touch-fire-right',
    x: 2.36,
    y: 0.62,
  },
]

interface TouchButtonProps {
  def: TouchButtonDef
  disabled: boolean
  onHold: (action: keyof InputState, held: boolean) => void
}

/**
 * A momentary round button. Every pointer that lands on it is captured, so several buttons
 * (move + fire) can be held at once and a finger sliding off does not drop the input.
 */
function TouchButton({ def, disabled, onHold }: TouchButtonProps) {
  const pointers = useRef(new Set<number>())
  const [pressed, setPressed] = useState(false)
  const onHoldRef = useRef(onHold)
  useEffect(() => {
    onHoldRef.current = onHold
  }, [onHold])

  const action = def.action
  const releaseAll = useCallback(() => {
    if (pointers.current.size === 0) return
    pointers.current.clear()
    setPressed(false)
    onHoldRef.current(action, false)
  }, [action])

  // Input is dropped when the game pauses (disabled) and when the screen goes away.
  useEffect(() => {
    if (disabled) releaseAll()
  }, [disabled, releaseAll])
  useEffect(() => releaseAll, [releaseAll])

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic or already-ended pointers cannot be captured; the button still works.
    }
    const wasIdle = pointers.current.size === 0
    pointers.current.add(event.pointerId)
    if (wasIdle) {
      setPressed(true)
      onHold(def.action, true)
    }
  }

  const release = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    if (pointers.current.size === 0) {
      setPressed(false)
      onHold(def.action, false)
    }
  }

  return (
    <IconButton
      icon={def.icon}
      label={def.label}
      size="lg"
      pressed={pressed}
      disabled={disabled}
      className="touch-btn"
      data-testid={def.testId}
      style={
        {
          left: `calc(${def.x} * var(--touch))`,
          top: `calc(${def.y} * var(--touch))`,
        } as CSSProperties
      }
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onPointerLeave={(event) => {
        // Only reachable without capture (capture suppresses leave while held).
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) release(event)
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

interface TouchControlsProps {
  /** False while paused, loading or ended: held input is released and presses are ignored. */
  enabled: boolean
  onHold: (action: keyof InputState, held: boolean) => void
}

/** On-screen controls (left: move, right: fire), laid out like the design, multi-touch capable. */
export const TouchControls = memo(function TouchControls({ enabled, onHold }: TouchControlsProps) {
  return (
    <div className="touch-controls hud-layer" data-testid="touch-controls">
      <div
        className="touch-cluster touch-cluster--left"
        role="group"
        aria-label="Movement controls"
      >
        {MOVE_BUTTONS.map((def) => (
          <TouchButton key={def.action} def={def} disabled={!enabled} onHold={onHold} />
        ))}
      </div>
      <div className="touch-cluster touch-cluster--right" role="group" aria-label="Weapon controls">
        {FIRE_BUTTONS.map((def) => (
          <TouchButton key={def.action} def={def} disabled={!enabled} onHold={onHold} />
        ))}
      </div>
    </div>
  )
})
