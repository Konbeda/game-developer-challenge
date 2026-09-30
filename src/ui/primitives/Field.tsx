import { useEffect, useId, useRef } from 'react'
import type { InputHTMLAttributes, KeyboardEvent, PointerEvent, ReactNode, Ref } from 'react'
import { cx } from './cx.ts'
import { IconButton } from './IconButton.tsx'

interface FieldControlProps {
  id: string
  'aria-describedby': string
  'aria-invalid': boolean
}

interface FieldProps {
  label: string
  hint?: string | undefined
  /** Error text; when set the control is marked invalid and the message is announced. */
  error?: string | null | undefined
  testId?: string | undefined
  className?: string | undefined
  /** Renders the control with the ids/aria wiring it must carry. */
  children: (props: FieldControlProps) => ReactNode
}

/** Label + control + hint + accessible error text. */
export function Field({ label, hint, error, testId, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, errorId].filter(Boolean).join(' ')
  return (
    <div className={cx('flex flex-col gap-1 text-left', className)} data-testid={testId}>
      <label htmlFor={id} className="text-sm font-bold tracking-wide text-cream">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {/* Always mounted so screen readers announce text as it appears. */}
      <div id={errorId} aria-live="polite" className="min-h-[1.1rem]">
        {error ? (
          <p
            className="text-sm font-bold text-danger"
            data-testid={testId ? `${testId}-error` : undefined}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function TextInput({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} type="text" className={cx('skin-input', className)} {...rest} />
}

/** Press-and-hold repeat for stepper buttons (pointer only; keyboard uses click). */
function useHoldRepeat(step: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  }, [step])

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    stop()
    stepRef.current()
    let delay = 420
    const tick = () => {
      stepRef.current()
      delay = Math.max(60, delay * 0.8)
      timer.current = setTimeout(tick, delay)
    }
    timer.current = setTimeout(tick, delay)
  }
  return { start, stop }
}

interface NumberFieldProps {
  label: string
  /** Raw text of the input, so partially typed or invalid values are preserved. */
  value: string
  onChange: (raw: string) => void
  /** Called with +1 / -1 by the round buttons and ArrowUp / ArrowDown. */
  onStep: (direction: 1 | -1) => void
  unit: string
  error?: string | null | undefined
  hint?: string | undefined
  min: number
  max: number
  testId: string
  canDecrease?: boolean
  canIncrease?: boolean
}

/** Round minus / editable value / round plus, as in the Options design. */
export function NumberField({
  label,
  value,
  onChange,
  onStep,
  unit,
  error,
  hint,
  min,
  max,
  testId,
  canDecrease = true,
  canIncrease = true,
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dec = useHoldRepeat(() => onStep(-1))
  const inc = useHoldRepeat(() => onStep(1))
  const numeric = Number(value.replace(',', '.'))

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onStep(1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onStep(-1)
    }
  }

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      testId={testId}
      className="items-center text-center"
    >
      {(control) => (
        <div className="flex items-center justify-center gap-3">
          <IconButton
            icon="minus"
            label={`Decrease ${label.toLowerCase()}`}
            disabled={!canDecrease}
            data-testid={`${testId}-decrease`}
            onPointerDown={dec.start}
            onPointerUp={dec.stop}
            onPointerLeave={dec.stop}
            onPointerCancel={dec.stop}
            onClick={(event) => {
              if (event.detail === 0) onStep(-1)
              inputRef.current?.focus({ preventScroll: true })
            }}
          />
          <div className="flex items-baseline justify-center">
            <input
              ref={inputRef}
              {...control}
              type="text"
              inputMode="decimal"
              role="spinbutton"
              autoComplete="off"
              spellCheck={false}
              aria-valuemin={min}
              aria-valuemax={max}
              {...(Number.isFinite(numeric) && value.trim() !== ''
                ? { 'aria-valuenow': numeric }
                : {})}
              aria-valuetext={`${value} ${unit === 's' ? 'seconds' : unit}`}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              className="skin-input skin-input--stepper"
              data-testid={`${testId}-input`}
            />
            <span aria-hidden="true" className="ml-1 font-display text-xl font-semibold text-cream">
              {unit}
            </span>
          </div>
          <IconButton
            icon="plus"
            label={`Increase ${label.toLowerCase()}`}
            disabled={!canIncrease}
            data-testid={`${testId}-increase`}
            onPointerDown={inc.start}
            onPointerUp={inc.stop}
            onPointerLeave={inc.stop}
            onPointerCancel={inc.stop}
            onClick={(event) => {
              if (event.detail === 0) onStep(1)
              inputRef.current?.focus({ preventScroll: true })
            }}
          />
        </div>
      )}
    </Field>
  )
}
