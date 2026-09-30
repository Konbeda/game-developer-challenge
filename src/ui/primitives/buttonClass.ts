import { cx } from './cx.ts'

export type ButtonVariant = 'primary' | 'secondary'
export type ButtonSize = 'sm' | 'md' | 'lg'

/** Class names for a skinned button, shared with other controls that must look like one (tabs). */
export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize = 'md',
  block = false,
  extra?: string,
): string {
  return cx(
    'skin-btn',
    `skin-btn--${variant}`,
    size === 'sm' && 'skin-btn--sm',
    size === 'lg' && 'skin-btn--lg',
    block && 'skin-btn--block',
    extra,
  )
}
