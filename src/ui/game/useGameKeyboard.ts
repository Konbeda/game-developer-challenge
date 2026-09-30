import { useEffect } from 'react'
import type { RefObject } from 'react'
import { EMPTY_INPUT } from '../../game/contracts.ts'
import type { GameHost, InputState } from '../../game/contracts.ts'
import { KEY_BINDINGS, PAUSE_KEYS } from '../../game/controls.ts'
import { isModalOpen } from '../primitives/index.ts'

const ACTIONS = Object.keys(KEY_BINDINGS) as (keyof InputState)[]

function actionForCode(code: string): keyof InputState | undefined {
  return ACTIONS.find((action) => KEY_BINDINGS[action].includes(code))
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Keyboard capture for the match: W sails, A / D rotate (tank style) and the arrow keys fire. It is
 * only attached while the game screen is mounted and the match is running with no dialog open, so
 * menus keep their normal keys (Space presses a focused button). It only prevents default for keys it
 * handles, and clears every held key on blur, hidden tab, pause and unmount. The touch stick has its
 * own path (`host.setSteer`) and is not touched here.
 */
export function useGameKeyboard(
  hostRef: RefObject<GameHost | null>,
  enabled: boolean,
  onPauseKey: () => void,
): void {
  useEffect(() => {
    if (!enabled) return
    const held = new Set<string>()

    const push = (action: keyof InputState) => {
      const active = KEY_BINDINGS[action].some((code) => held.has(code))
      hostRef.current?.setInput({ [action]: active })
    }
    const releaseAll = () => {
      held.clear()
      hostRef.current?.setInput({ ...EMPTY_INPUT })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isModalOpen() ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditable(event.target)
      )
        return
      if (PAUSE_KEYS.includes(event.code)) {
        event.preventDefault()
        if (!event.repeat) onPauseKey()
        return
      }
      const action = actionForCode(event.code)
      if (!action) return
      event.preventDefault()
      if (held.has(event.code)) return
      held.add(event.code)
      push(action)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const action = actionForCode(event.code)
      if (!action) return
      if (held.delete(event.code)) push(action)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseAll()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibility)
      releaseAll()
    }
  }, [enabled, hostRef, onPauseKey])
}
