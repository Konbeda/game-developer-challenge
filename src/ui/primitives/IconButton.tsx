import type { ButtonHTMLAttributes, Ref } from 'react'
import type { SkinIconName } from '../skin.ts'
import { cx } from './cx.ts'
import { Icon } from './Icon.tsx'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: SkinIconName
  /** Accessible name. Required: the button has no visible text. */
  label: string
  size?: 'sm' | 'md' | 'lg'
  /** Renders the pressed sprite (used by touch controls while a pointer holds the button). */
  pressed?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** Round sprite button with an icon (steppers, pagination arrows, HUD pause, touch controls). */
export function IconButton({
  icon,
  label,
  size = 'md',
  pressed,
  type = 'button',
  className,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-pressed={pressed ? 'true' : undefined}
      className={cx(
        'skin-round',
        size === 'sm' && 'skin-round--sm',
        size === 'lg' && 'skin-round--lg',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}
