import { describe, expect, it } from 'vitest'
import { storedPlayerSchema, validatePlayerName } from './player.ts'

describe('validatePlayerName', () => {
  it('accepts allowlisted names and normalises spaces', () => {
    expect(validatePlayerName('Captain Jack')).toEqual({ ok: true, value: 'Captain Jack' })
    expect(validatePlayerName('  Red   Sparrow ')).toEqual({ ok: true, value: 'Red Sparrow' })
    expect(validatePlayerName('sea_wolf-99')).toEqual({ ok: true, value: 'sea_wolf-99' })
  })

  it.each(['', '   ', 'a'.repeat(17), '<b>x</b>', 'Jack!', 'Jack\tSparrow', 'Ünder', "'; DROP"])(
    'rejects %j with a message',
    (raw) => {
      const result = validatePlayerName(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
    },
  )

  it('accepts exactly 16 characters', () => {
    expect(validatePlayerName('a'.repeat(16)).ok).toBe(true)
  })
})

describe('storedPlayerSchema', () => {
  it('validates the persisted identity strictly', () => {
    expect(
      storedPlayerSchema.safeParse({ playerId: 'abcdefgh', playerName: 'Captain' }).success,
    ).toBe(true)
    expect(storedPlayerSchema.safeParse({ playerId: 'short', playerName: 'Captain' }).success).toBe(
      false,
    )
    expect(storedPlayerSchema.safeParse({ playerId: 'abcdefgh', playerName: '<x>' }).success).toBe(
      false,
    )
    expect(
      storedPlayerSchema.safeParse({ playerId: 'abcdefgh', playerName: 'Captain', extra: 1 })
        .success,
    ).toBe(false)
  })
})
