import { useEffect } from 'react'
import type { RefObject } from 'react'
import { EMPTY_INPUT } from '../../game/contracts.ts'
import type { GameHost } from '../../game/contracts.ts'
import { FIRE_BINDINGS, MOVE_CODES, PAUSE_KEYS, steerFromKeys } from '../../game/controls.ts'
import { isModalOpen } from '../primitives/index.ts'

type FireAction = keyof typeof FIRE_BINDINGS
const FIRE_ACTIONS = Object.keys(FIRE_BINDINGS) as FireAction[]

function fireActionForCode(code: string): FireAction | undefined {
  return FIRE_ACTIONS.find((action) => FIRE_BINDINGS[action].includes(code))
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Keyboard capture for the match. W/A/S/D choose the direction to sail (they feed the same stick
 * steering as touch, so there is no tank-style turning) and the arrow keys fire. It is only
 * attached while the game screen is mounted and the match is running with no dialog open, so menus
 * keep their normal keys (Space presses a focused button). It only prevents default for keys it
 * handles, and clears every held key on blur, hidden tab, pause and unmount.
 */
export function useGameKeyboard(
  hostRef: RefObject<GameHost | null>,
  enabled: boolean,
  onPauseKey: () => void,
): void {
  useEffect(() => {
    if (!enabled) return
    const held = new Set<string>()

    const pushFire = (action: FireAction) => {
      const active = FIRE_BINDINGS[action].some((code) => held.has(code))
      hostRef.current?.setInput({ [action]: active })
    }
    const pushSteer = () => {
      hostRef.current?.setSteer(steerFromKeys(held))
    }
    const push = (code: string) => {
      const fire = fireActionForCode(code)
      if (fire) pushFire(fire)
      else pushSteer()
    }
    const releaseAll = () => {
      held.clear()
      hostRef.current?.setInput({ ...EMPTY_INPUT })
      hostRef.current?.setSteer(null)
    }

    const handles = (code: string) =>
      MOVE_CODES.includes(code) || fireActionForCode(code) !== undefined

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
      if (!handles(event.code)) return
      event.preventDefault()
      if (held.has(event.code)) return
      held.add(event.code)
      push(event.code)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (!handles(event.code)) return
      if (held.delete(event.code)) push(event.code)
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
