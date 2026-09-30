import type { ButtonHTMLAttributes, Ref } from 'react'
import { cx } from './cx.ts'

/** Discreet text button for secondary actions (footer links, "Change name"). */
export function LinkButton({
  className,
  type = 'button',
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'cursor-pointer rounded-chip px-1.5 py-0.5 text-xs font-bold tracking-wide text-cream underline decoration-cream/50 underline-offset-2 hover:decoration-cream',
        className,
      )}
      {...rest}
    />
  )
}
