import type { InputState } from './contracts.ts'

/**
 * Keyboard bindings by `KeyboardEvent.code`. Single source of truth: the input layer captures
 * these keys and the UI renders the same list as instructions.
 *
 * Keyboard movement is tank style: W sails forward and A / D rotate the ship. Weapons are on the
 * arrow keys, one hand each (Up = front cannon, Left / Right = broadsides). Touch screens use a
 * steering stick instead (see `steering.ts`).
 */
export const KEY_BINDINGS: Record<keyof InputState, readonly string[]> = {
  forward: ['KeyW'],
  turnLeft: ['KeyA'],
  turnRight: ['KeyD'],
  fireFront: ['ArrowUp'],
  fireLeft: ['ArrowLeft'],
  fireRight: ['ArrowRight'],
}

export const PAUSE_KEYS: readonly string[] = ['KeyP', 'Escape']

/** Human-readable instruction rows for menus and the pause dialog. */
export const CONTROL_HELP: readonly { action: string; keys: string; touch: string }[] = [
  { action: 'Sail forward', keys: 'W', touch: 'Push the stick' },
  { action: 'Turn left', keys: 'A', touch: 'Point the stick to steer' },
  { action: 'Turn right', keys: 'D', touch: 'Point the stick to steer' },
  { action: 'Fire front cannon', keys: 'Up', touch: 'Crosshair button' },
  { action: 'Fire left broadside (3 shots)', keys: 'Left', touch: 'Left flame button' },
  { action: 'Fire right broadside (3 shots)', keys: 'Right', touch: 'Right flame button' },
  { action: 'Pause', keys: 'P / Esc', touch: 'Pause button' },
]
