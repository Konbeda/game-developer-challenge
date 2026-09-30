import { useSyncExternalStore } from 'react'

/**
 * Tracks modal layers (dialogs, the rotate overlay). While any is open the app root is `inert`,
 * so nothing behind it can take focus or clicks, and the game keyboard capture stands down.
 */
const listeners = new Set<() => void>()
const stack: symbol[] = []

function rootElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById('root')
}

function emit(): void {
  listeners.forEach((listener) => listener())
}

/** Registers a modal layer and returns its release function. */
export function pushModal(): { id: symbol; release: () => void } {
  const id = Symbol('modal')
  stack.push(id)
  const root = rootElement()
  if (root) root.inert = true
  emit()
  return {
    id,
    release: () => {
      const index = stack.indexOf(id)
      if (index === -1) return
      stack.splice(index, 1)
      const el = rootElement()
      if (el && stack.length === 0) el.inert = false
      emit()
    },
  }
}

export function isTopModal(id: symbol): boolean {
  return stack[stack.length - 1] === id
}

export function isModalOpen(): boolean {
  return stack.length > 0
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React view of `isModalOpen()`. */
export function useModalOpen(): boolean {
  return useSyncExternalStore(subscribe, isModalOpen, () => false)
}
