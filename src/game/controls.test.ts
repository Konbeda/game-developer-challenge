import { describe, expect, it } from 'vitest'
import { CONTROL_HELP, FIRE_BINDINGS, MOVE_CODES, PAUSE_KEYS, steerFromKeys } from './controls.ts'

const keys = (...codes: string[]) => new Set(codes)

describe('steerFromKeys', () => {
  it('is null with no movement key held', () => {
    expect(steerFromKeys(keys())).toBeNull()
    // Weapon and pause keys never steer.
    expect(steerFromKeys(keys('ArrowUp', 'ArrowLeft', 'Space', 'Escape'))).toBeNull()
  })

  it('points the four screen directions with a full push', () => {
    expect(steerFromKeys(keys('KeyD'))).toEqual({ angle: 0, magnitude: 1 })
    expect(steerFromKeys(keys('KeyS'))?.angle).toBeCloseTo(Math.PI / 2)
    expect(steerFromKeys(keys('KeyW'))?.angle).toBeCloseTo(-Math.PI / 2)
    expect(Math.abs(steerFromKeys(keys('KeyA'))?.angle ?? 0)).toBeCloseTo(Math.PI)
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      expect(steerFromKeys(keys(code))?.magnitude).toBe(1)
    }
  })

  it('combines two keys into a diagonal', () => {
    expect(steerFromKeys(keys('KeyW', 'KeyD'))?.angle).toBeCloseTo(-Math.PI / 4)
    expect(steerFromKeys(keys('KeyS', 'KeyD'))?.angle).toBeCloseTo(Math.PI / 4)
    expect(steerFromKeys(keys('KeyS', 'KeyA'))?.angle).toBeCloseTo((3 * Math.PI) / 4)
    expect(steerFromKeys(keys('KeyW', 'KeyA'))?.angle).toBeCloseTo((-3 * Math.PI) / 4)
  })

  it('cancels opposite keys, and keeps the remaining axis', () => {
    expect(steerFromKeys(keys('KeyA', 'KeyD'))).toBeNull()
    expect(steerFromKeys(keys('KeyW', 'KeyS'))).toBeNull()
    expect(steerFromKeys(keys('KeyW', 'KeyS', 'KeyD'))?.angle).toBeCloseTo(0)
    expect(steerFromKeys(keys('KeyA', 'KeyD', 'KeyS'))?.angle).toBeCloseTo(Math.PI / 2)
  })
})

describe('bindings', () => {
  it('puts the weapons on the arrow keys: up front, left and right broadsides', () => {
    expect(FIRE_BINDINGS).toEqual({
      fireFront: ['ArrowUp'],
      fireLeft: ['ArrowLeft'],
      fireRight: ['ArrowRight'],
    })
  })

  it('never binds a key to two things', () => {
    const all = [...MOVE_CODES, ...Object.values(FIRE_BINDINGS).flat(), ...PAUSE_KEYS]
    expect(new Set(all).size).toBe(all.length)
  })

  it('lists one help row per action with a keyboard and a touch hint', () => {
    expect(CONTROL_HELP.map((row) => row.action)).toEqual([
      'Steer and sail',
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
