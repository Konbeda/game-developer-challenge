import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx.ts'
import { isTopModal, pushModal } from './modalRegistry.ts'
import { Panel } from './Panel.tsx'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  )
}

interface DialogProps {
  /** Visible heading; also the accessible name of the dialog. */
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /**
   * Escape handler. When omitted, Escape does nothing (the dialog needs an explicit choice,
   * e.g. the pause dialog after an automatic pause).
   */
  onDismiss?: (() => void) | undefined
  /** Element to focus first; defaults to the first focusable control. */
  initialFocusRef?: RefObject<HTMLElement | null>
  role?: 'dialog' | 'alertdialog'
  size?: 'sm' | 'md'
  /** Give focus back to the element that had it before opening (default). Turn off for game overlays. */
  restoreFocus?: boolean
  testId?: string
}

/**
 * Modal dialog rendered in a portal: focus moves in, Tab/Shift+Tab wrap inside, the rest of the
 * app is inert, and focus returns to the previously focused element on close. Mount it only
 * while it should be visible.
 */
export function Dialog({
  title,
  description,
  children,
  onDismiss,
  initialFocusRef,
  role = 'dialog',
  size = 'sm',
  restoreFocus = true,
  testId,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const dismissRef = useRef(onDismiss)
  const optionsRef = useRef({ initialFocusRef, restoreFocus })

  useEffect(() => {
    dismissRef.current = onDismiss
    optionsRef.current = { initialFocusRef, restoreFocus }
  })

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const { id, release } = pushModal()

    const target = optionsRef.current.initialFocusRef?.current ?? focusableWithin(panel)[0] ?? panel
    target.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(id)) return
      if (event.key === 'Escape') {
        if (dismissRef.current) {
          event.preventDefault()
          event.stopPropagation()
          dismissRef.current()
        }
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableWithin(panel)
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      release()
      if (optionsRef.current.restoreFocus && previouslyFocused?.isConnected)
        previouslyFocused.focus({ preventScroll: true })
    }
    // Runs once per open by design; options are read through refs.
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-[rgba(4,10,20,0.62)] p-3"
      data-testid={testId ? `${testId}-backdrop` : undefined}
    >
      <Panel
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={cx(
          'max-h-[calc(100dvh-1.5rem)] outline-none',
          size === 'md' ? 'w-[min(36rem,100%)]' : 'w-[min(26rem,100%)]',
        )}
      >
        <div className="skin-scroll min-h-0 overflow-y-auto px-2 py-1 text-center">
          <h2
            id={titleId}
            className="font-display text-[1.6rem] leading-tight short:text-[1.35rem] font-semibold tracking-wide text-cream uppercase title-shadow"
          >
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-2 text-sm text-cream-dim short:sr-only">
              {description}
            </p>
          ) : null}
          <div className="mt-4 short:mt-2">{children}</div>
        </div>
      </Panel>
    </div>,
    document.body,
  )
}
