import type { ButtonHTMLAttributes, Ref } from 'react'
import { buttonClass } from './buttonClass.ts'
import type { ButtonSize, ButtonVariant } from './buttonClass.ts'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = gold plank, secondary = dark plank. */
  variant?: ButtonVariant
  size?: ButtonSize
  /** Full width of the container. */
  block?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  type = 'button',
  className,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, block, className)}
      {...rest}
    />
  )
}
