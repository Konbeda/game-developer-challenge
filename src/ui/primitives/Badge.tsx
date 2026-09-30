import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export type BadgeTone = 'you' | 'success' | 'danger' | 'info' | 'neutral'

const TONES: Record<BadgeTone, string> = {
  you: 'border-gold bg-[rgba(246,185,59,0.18)] text-gold-bright',
  success: 'border-[#7fb56a] bg-[rgba(127,181,106,0.18)] text-success',
  danger: 'border-[#d97a68] bg-[rgba(217,122,104,0.18)] text-danger',
  info: 'border-[#7aa6d9] bg-[rgba(122,166,217,0.18)] text-[#c6ddf7]',
  neutral: 'border-[#7f8da5] bg-[rgba(127,141,165,0.18)] text-muted',
}

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  testId?: string
}

/** Small pill: YOU marker, sync status. Meaning always comes from the text, never colour alone. */
export function Badge({ tone = 'neutral', children, className, testId }: BadgeProps) {
  return (
    <span
      data-testid={testId}
      className={cx(
        'inline-flex items-center rounded-chip border px-1.5 py-px align-middle text-[0.62rem] leading-tight font-bold tracking-wider uppercase',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
