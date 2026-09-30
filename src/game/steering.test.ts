import { describe, expect, it } from 'vitest'
import { angleError, STEER, steerToInput } from './steering.ts'

const EAST = 0
const SOUTH = Math.PI / 2
const WEST = Math.PI
const NORTH = -Math.PI / 2

describe('angleError', () => {
  it('is the signed smallest difference', () => {
    expect(angleError(SOUTH, EAST)).toBeCloseTo(Math.PI / 2)
    expect(angleError(NORTH, EAST)).toBeCloseTo(-Math.PI / 2)
    expect(angleError(0.1, 0.1)).toBe(0)
  })

  it('wraps around the +-PI seam the short way', () => {
    // Heading just before west (3.0), target just after it (-3.0): a small clockwise step.
    expect(angleError(-3.0, 3.0)).toBeCloseTo(2 * Math.PI - 6.0)
    expect(angleError(3.0, -3.0)).toBeCloseTo(-(2 * Math.PI - 6.0))
  })

  it('handles values outside one turn', () => {
    expect(angleError(10 * Math.PI + 0.25, 0)).toBeCloseTo(0.25)
    expect(angleError(-10 * Math.PI - 0.25, 0)).toBeCloseTo(-0.25)
  })
})

describe('steerToInput', () => {
  const full = (angle: number) => ({ angle, magnitude: 1 })

  it('does nothing without a target or inside the dead zone', () => {
    const off = { forward: false, turnLeft: false, turnRight: false }
    expect(steerToInput(null, EAST)).toEqual(off)
    expect(steerToInput({ angle: SOUTH, magnitude: STEER.deadZone - 0.01 }, EAST)).toEqual(off)
  })

  it('sails straight when the ship already faces the stick', () => {
    expect(steerToInput(full(EAST), EAST)).toEqual({
      forward: true,
      turnLeft: false,
      turnRight: false,
    })
    // Within the deadband the nose does not twitch.
    expect(steerToInput(full(EAST + STEER.turnDeadband / 2), EAST).turnRight).toBe(false)
  })

  it('turns clockwise (right) towards a target clockwise of the bow, counter-clockwise (left) otherwise', () => {
    expect(steerToInput(full(SOUTH), EAST)).toMatchObject({ turnRight: true, turnLeft: false })
    expect(steerToInput(full(NORTH), EAST)).toMatchObject({ turnLeft: true, turnRight: false })
  })

  it('takes the short way round the seam', () => {
    // Facing 3.0 rad (almost west), stick just past west (-3.0): a short clockwise turn, not a long one.
    expect(steerToInput(full(-3.0), 3.0)).toMatchObject({ turnRight: true, turnLeft: false })
    expect(steerToInput(full(3.0), -3.0)).toMatchObject({ turnLeft: true, turnRight: false })
  })

  it('keeps sailing through a moderate turn but turns in place for a reversal', () => {
    expect(steerToInput(full(SOUTH), EAST).forward).toBe(true)
    const reversal = steerToInput(full(WEST), EAST)
    expect(reversal.forward).toBe(false)
    expect(reversal.turnRight || reversal.turnLeft).toBe(true)
  })

  it('a light push steers without sailing forward', () => {
    const light = steerToInput(
      { angle: SOUTH, magnitude: (STEER.deadZone + STEER.forwardFrom) / 2 },
      EAST,
    )
    expect(light.forward).toBe(false)
    expect(light.turnRight).toBe(true)
  })
})
