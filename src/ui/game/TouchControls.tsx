import { memo, useCallback, useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import type { InputState, SteerTarget } from '../../game/contracts.ts'

/** Fraction of the pad radius that counts as a full push of the stick. */
const FULL_PUSH = 0.85
/** How far the knob travels from the centre, as a fraction of the pad radius. */
const KNOB_TRAVEL = 0.5

interface StickProps {
  disabled: boolean
  onSteer: (target: SteerTarget | null) => void
}

/**
 * Virtual stick (left thumb). The ship turns to where the thumb points and sails while it is
 * pushed. One pointer drives it; it keeps following that finger wherever it slides (pointer
 * capture), and it lets go when the game pauses or the screen goes away. The knob is moved
 * straight on the DOM so dragging never re-renders React.
 */
function TouchStick({ disabled, onSteer }: StickProps) {
  const padRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const activeId = useRef<number | null>(null)
  const onSteerRef = useRef(onSteer)
  useEffect(() => {
    onSteerRef.current = onSteer
  }, [onSteer])

  const release = useCallback(() => {
    if (activeId.current === null) return
    activeId.current = null
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)'
    if (padRef.current) padRef.current.dataset['active'] = 'false'
    onSteerRef.current(null)
  }, [])

  useEffect(() => {
    if (disabled) release()
  }, [disabled, release])
  useEffect(() => release, [release])

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const pad = padRef.current
    const knob = knobRef.current
    if (!pad || !knob) return
    const rect = pad.getBoundingClientRect()
    const radius = rect.width / 2
    const dx = event.clientX - (rect.left + radius)
    const dy = event.clientY - (rect.top + radius)
    const distance = Math.hypot(dx, dy)
    // Screen vector angle (y down) is exactly the simulation's heading convention.
    const angle = Math.atan2(dy, dx)
    const reach = Math.min(distance, radius * KNOB_TRAVEL)
    knob.style.transform = `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px)`
    onSteerRef.current({ angle, magnitude: Math.min(1, distance / (radius * FULL_PUSH)) })
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || activeId.current !== null) return
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic or already-ended pointers cannot be captured; the stick still works.
    }
    activeId.current = event.pointerId
    if (padRef.current) padRef.current.dataset['active'] = 'true'
    follow(event)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId === activeId.current) follow(event)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerId === activeId.current) release()
  }

  return (
    <div
      ref={padRef}
      className="touch-ctl touch-stick"
      data-testid="touch-stick"
      data-active="false"
      role="group"
      aria-label="Steering stick: push towards where the ship should sail"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={knobRef} className="touch-stick-knob" />
    </div>
  )
}

interface FireDef {
  action: keyof InputState
  label: string
  testId: string
  className: string
}

const FIRE_BUTTONS: readonly FireDef[] = [
  {
    action: 'fireLeft',
    label: 'Fire left broadside',
    testId: 'touch-fire-left',
    className: 'touch-fire--left',
  },
  {
    action: 'fireFront',
    label: 'Fire front cannon',
    testId: 'touch-fire-front',
    className: 'touch-fire--front',
  },
  {
    action: 'fireRight',
    label: 'Fire right broadside',
    testId: 'touch-fire-right',
    className: 'touch-fire--right',
  },
]

interface FireButtonProps {
  def: FireDef
  disabled: boolean
  onHold: (action: keyof InputState, held: boolean) => void
}

/**
 * A momentary weapon button. Every pointer that lands on it is captured, so the stick and several
 * weapons can be held at once and a finger sliding off does not drop the input.
 */
function FireButton({ def, disabled, onHold }: FireButtonProps) {
  const pointers = useRef(new Set<number>())
  const buttonRef = useRef<HTMLButtonElement>(null)
  const onHoldRef = useRef(onHold)
  useEffect(() => {
    onHoldRef.current = onHold
  }, [onHold])

  const action = def.action
  const releaseAll = useCallback(() => {
    if (pointers.current.size === 0) return
    pointers.current.clear()
    buttonRef.current?.setAttribute('aria-pressed', 'false')
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
      buttonRef.current?.setAttribute('aria-pressed', 'true')
      onHold(action, true)
    }
  }

  const release = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    if (pointers.current.size === 0) {
      buttonRef.current?.setAttribute('aria-pressed', 'false')
      onHold(action, false)
    }
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`touch-ctl touch-fire ${def.className}`}
      aria-label={def.label}
      aria-pressed="false"
      disabled={disabled}
      data-testid={def.testId}
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
  onSteer: (target: SteerTarget | null) => void
}

/**
 * On-screen controls: a steering stick on the left, weapons on the right. Drawn semi-transparent so
 * the arena stays readable; a control becomes more opaque while it is held. Multi-touch capable.
 */
export const TouchControls = memo(function TouchControls({
  enabled,
  onHold,
  onSteer,
}: TouchControlsProps) {
  return (
    <div className="touch-controls hud-layer" data-testid="touch-controls">
      <TouchStick disabled={!enabled} onSteer={onSteer} />
      <div className="touch-fire-cluster" role="group" aria-label="Weapon controls">
        {FIRE_BUTTONS.map((def) => (
          <FireButton key={def.action} def={def} disabled={!enabled} onHold={onHold} />
        ))}
      </div>
    </div>
  )
})
