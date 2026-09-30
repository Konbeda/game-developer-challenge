import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { cx } from './cx.ts'

interface ScreenTitleProps {
  children: ReactNode
  className?: string
  testId?: string
  /** Moves focus to the heading on mount so screen readers and keyboard users land on the new screen. */
  focusOnMount?: boolean
}

/** The `h1` of a screen. Focused programmatically (never in the tab order) on navigation. */
export function ScreenTitle({
  children,
  className,
  testId,
  focusOnMount = true,
}: ScreenTitleProps) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: true })
  }, [focusOnMount])
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      data-testid={testId}
      className={cx(
        'font-display text-[2rem] leading-none font-semibold tracking-wide text-cream uppercase title-shadow',
        className,
      )}
    >
      {children}
    </h1>
  )
}
