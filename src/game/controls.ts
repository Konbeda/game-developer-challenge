import type { InputState } from './contracts.ts'

/**
 * Keyboard bindings by `KeyboardEvent.code`. Single source of truth: the input layer captures
 * these keys and the UI renders the same list as instructions.
 */
export const KEY_BINDINGS: Record<keyof InputState, readonly string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  turnLeft: ['KeyA', 'ArrowLeft'],
  turnRight: ['KeyD', 'ArrowRight'],
  fireFront: ['Space'],
  fireLeft: ['KeyQ'],
  fireRight: ['KeyE'],
}

export const PAUSE_KEYS: readonly string[] = ['KeyP', 'Escape']

/** Human-readable instruction rows for menus and the pause dialog. */
export const CONTROL_HELP: readonly { action: string; keys: string; touch: string }[] = [
  { action: 'Sail forward', keys: 'W / Up', touch: 'Forward button' },
  { action: 'Turn left', keys: 'A / Left', touch: 'Turn left button' },
  { action: 'Turn right', keys: 'D / Right', touch: 'Turn right button' },
  { action: 'Fire front cannon', keys: 'Space', touch: 'Front cannon button' },
  { action: 'Fire left broadside (3 shots)', keys: 'Q', touch: 'Left broadside button' },
  { action: 'Fire right broadside (3 shots)', keys: 'E', touch: 'Right broadside button' },
  { action: 'Pause', keys: 'P / Esc', touch: 'Pause button' },
]
