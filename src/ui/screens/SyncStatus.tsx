import { useMatchSubmission } from '../../api/hooks.ts'
import type { SubmissionStatus } from '../../contracts/outbox.ts'
import { Badge, Button, Spinner } from '../primitives/index.ts'
import type { BadgeTone } from '../primitives/index.ts'

const VIEW: Record<SubmissionStatus, { tone: BadgeTone; badge: string; message: string }> = {
  pending: {
    tone: 'info',
    badge: 'Pending',
    message: 'Your score is stored on this device and will be sent to the log shortly.',
  },
  syncing: { tone: 'info', badge: 'Sending', message: 'Sending your score to the Captain’s Log…' },
  synced: { tone: 'success', badge: 'Recorded', message: 'Your score is in the Captain’s Log.' },
  failed: {
    tone: 'danger',
    badge: 'Not sent',
    message: 'The log could not be reached. Your score is kept and will be retried.',
  },
}

interface SyncStatusProps {
  matchId: string
  testId: string
  /** Hides the long explanation (menu card). */
  compact?: boolean
  align?: 'center' | 'start'
}

/** Record status of one finished match, with a Retry action while it is not confirmed. */
export function SyncStatus({ matchId, testId, compact, align = 'center' }: SyncStatusProps) {
  const submission = useMatchSubmission(matchId)
  if (!submission) return null
  const view = VIEW[submission.status]
  const canRetry = submission.status === 'failed' || submission.status === 'pending'
  return (
    <div
      className={
        align === 'start' ? 'flex flex-col items-start gap-2' : 'flex flex-col items-center gap-2'
      }
      data-testid={`${testId}-wrap`}
    >
      <div
        role="status"
        data-testid={testId}
        data-status={submission.status}
        className={
          align === 'start'
            ? 'flex flex-wrap items-center justify-start gap-x-2 gap-y-1 text-sm'
            : 'flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm'
        }
      >
        {submission.status === 'syncing' ? <Spinner small /> : null}
        <Badge tone={view.tone} testId={`${testId}-badge`}>
          {view.badge}
        </Badge>
        {compact ? null : <span className="max-w-[36ch] text-cream">{view.message}</span>}
        {submission.status === 'failed' && submission.error && !compact ? (
          <span className="w-full text-xs text-muted" data-testid={`${testId}-error`}>
            {submission.error}
          </span>
        ) : null}
      </div>
      {canRetry ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={submission.retry}
          data-testid={`${testId}-retry`}
        >
          Retry
        </Button>
      ) : null}
    </div>
  )
}
