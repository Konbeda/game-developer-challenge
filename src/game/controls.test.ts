import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT } from './contracts.ts'
import { CONTROL_HELP, KEY_BINDINGS, PAUSE_KEYS } from './controls.ts'

describe('keyboard bindings', () => {
  it('uses tank-style movement: W forward, A / D rotate', () => {
    expect(KEY_BINDINGS.forward).toEqual(['KeyW'])
    expect(KEY_BINDINGS.turnLeft).toEqual(['KeyA'])
    expect(KEY_BINDINGS.turnRight).toEqual(['KeyD'])
  })

  it('puts the weapons on the arrow keys: up front, left and right broadsides', () => {
    expect(KEY_BINDINGS.fireFront).toEqual(['ArrowUp'])
    expect(KEY_BINDINGS.fireLeft).toEqual(['ArrowLeft'])
    expect(KEY_BINDINGS.fireRight).toEqual(['ArrowRight'])
  })

  it('binds every input action', () => {
    expect(Object.keys(KEY_BINDINGS).sort()).toEqual(Object.keys(EMPTY_INPUT).sort())
    for (const codes of Object.values(KEY_BINDINGS)) expect(codes.length).toBeGreaterThan(0)
  })

  it('never binds a key to two things', () => {
    const all = [...Object.values(KEY_BINDINGS).flat(), ...PAUSE_KEYS]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('control help', () => {
  it('lists one row per action with a keyboard and a touch hint', () => {
    expect(CONTROL_HELP.map((row) => row.action)).toEqual([
      'Sail forward',
      'Turn left',
      'Turn right',
      'Fire front cannon',
      'Fire left broadside (3 shots)',
      'Fire right broadside (3 shots)',
      'Pause',
    ])
    for (const row of CONTROL_HELP) {
      expect(row.keys.length).toBeGreaterThan(0)
      expect(row.touch.length).toBeGreaterThan(0)
    }
  })
})
