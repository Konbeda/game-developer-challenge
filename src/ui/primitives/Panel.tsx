import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { cx } from './cx.ts'

interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  /** Tailwind width classes; the panel is content-sized otherwise. */
  ref?: Ref<HTMLElement>
}

/** Wooden frame + chalkboard. The 9-slice art comes from the skin (see skin.ts / .skin-panel). */
export function Panel({ className, children, ref, ...rest }: PanelProps) {
  return (
    <section ref={ref} className={cx('skin-panel', className)} {...rest}>
      {children}
    </section>
  )
}
