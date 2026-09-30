import type { CSSProperties } from 'react'
import { skinIconUrl } from '../skin.ts'
import type { SkinIconName } from '../skin.ts'

interface IconProps {
  name: SkinIconName
  className?: string
  style?: CSSProperties
}

/** Decorative sprite icon. Always paired with a text label somewhere (aria-label or visible text). */
export function Icon({ name, className, style }: IconProps) {
  return (
    <img
      src={skinIconUrl(name)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
      style={style}
      width={48}
      height={48}
    />
  )
}
