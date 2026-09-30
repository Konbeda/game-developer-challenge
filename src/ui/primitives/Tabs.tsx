import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { buttonClass } from './buttonClass.ts'
import { tabIds } from './tabIds.ts'

export interface TabDef<T extends string> {
  id: T
  label: string
  testId?: string
}

interface TabsProps<T extends string> {
  /** Accessible name of the tab list. */
  label: string
  tabs: readonly TabDef<T>[]
  value: T
  onChange: (id: T) => void
  /** Prefix that ties tabs to their panels (see `tabIds`). */
  idPrefix: string
}

/** Accessible tab list (roving tabindex, arrow keys, Home/End). Selected tab = gold plank. */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>())

  const move = (event: KeyboardEvent, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    const tab = tabs[next]
    if (!tab) return
    onChange(tab.id)
    refs.current.get(tab.id)?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap justify-center gap-2">
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el)
              else refs.current.delete(tab.id)
            }}
            type="button"
            role="tab"
            id={tabIds(idPrefix, tab.id).tab}
            aria-controls={tabIds(idPrefix, tab.id).panel}
            aria-selected={selected}
            aria-current={selected ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            data-testid={tab.testId}
            className={buttonClass(selected ? 'primary' : 'secondary', 'md')}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

interface TabPanelProps {
  idPrefix: string
  id: string
  children: ReactNode
  className?: string
  testId?: string
}

export function TabPanel({ idPrefix, id, children, className, testId }: TabPanelProps) {
  const ids = tabIds(idPrefix, id)
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={-1}
      className={className}
      data-testid={testId}
    >
      {children}
    </div>
  )
}
