import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import { cx } from './cx.ts'

export function Spinner({ small, className }: { small?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('skin-spinner', small && 'skin-spinner--sm', className)}
    />
  )
}

interface LoadingStateProps {
  label?: string
  /** Placeholder rows that keep the layout stable while data loads. */
  skeletonRows?: number
  testId?: string
}

/** Blocking-free loading placeholder for a region: spinner, label and optional skeleton rows. */
export function LoadingState({ label = 'Loading…', skeletonRows = 0, testId }: LoadingStateProps) {
  return (
    <div role="status" data-testid={testId} className="flex flex-col items-center gap-3 py-4">
      <div className="flex items-center gap-2 text-sm font-bold tracking-wide text-cream-dim uppercase">
        <Spinner />
        <span>{label}</span>
      </div>
      {skeletonRows > 0 ? (
        <div aria-hidden="true" className="flex w-full flex-col gap-2">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <div key={index} className="skin-skeleton h-9 w-full" />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  retrying?: boolean
  testId?: string
}

/** Error message with a Retry button. `role="alert"` so it is announced when it appears. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retrying,
  testId,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-col items-center gap-2 rounded-field border border-[#d97a68]/60 bg-[rgba(120,40,30,0.25)] px-4 py-4 text-center"
    >
      <p className="font-display text-lg font-semibold text-danger">{title}</p>
      <p className="max-w-[34ch] text-sm text-cream">{message}</p>
      {onRetry ? (
        <Button
          variant="primary"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          data-testid={testId ? `${testId}-retry` : undefined}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      ) : null}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  message?: string
  action?: ReactNode
  testId?: string
}

export function EmptyState({ title, message, action, testId }: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-2 rounded-field bg-board-row px-4 py-6 text-center"
    >
      <p className="font-display text-lg font-semibold text-cream">{title}</p>
      {message ? <p className="max-w-[38ch] text-sm text-muted">{message}</p> : null}
      {action}
    </div>
  )
}

/** Determinate progress bar (asset loading). */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="skin-progress"
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  )
}
