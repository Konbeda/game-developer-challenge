import type { CSSProperties } from 'react'
import { useMuted } from '../lib/useMuted.ts'
import { IconButton } from '../primitives/index.ts'

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"
        fill="#ffe9b9"
        stroke="#7a4a12"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="m15.5 9.5 5 5m0-5-5 5" stroke="#ffe9b9" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <>
          <path
            d="M15.4 9.2a4 4 0 0 1 0 5.6"
            stroke="#ffe9b9"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M18 6.9a7.4 7.4 0 0 1 0 10.2"
            stroke="#ffe9b9"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}

interface SoundToggleProps {
  className?: string
  style?: CSSProperties
  size?: 'sm' | 'md' | 'lg'
}

/** Sound on/off. `aria-pressed` is true while sound is ON; the preference is stored by the audio engine. */
export function SoundToggle({ className, style, size }: SoundToggleProps) {
  const { muted, toggle } = useMuted()
  return (
    <IconButton
      glyph={<Speaker muted={muted} />}
      label="Sound"
      aria-pressed={!muted}
      title={muted ? 'Sound is off' : 'Sound is on'}
      onClick={toggle}
      data-testid="sound-toggle"
      data-muted={muted ? 'true' : 'false'}
      {...(size ? { size } : {})}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
    />
  )
}
