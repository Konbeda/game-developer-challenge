import { describe, expect, it } from 'vitest'
import { pickVariant, skinCssVariables } from './skin.ts'

describe('skin', () => {
  it('picks retina sprites from 1.5x pixel density up', () => {
    expect(pickVariant(1)).toBe('default')
    expect(pickVariant(1.25)).toBe('default')
    expect(pickVariant(1.5)).toBe('retina')
    expect(pickVariant(3)).toBe('retina')
  })

  it('scales 9-slice borders with the sprite variant (ui_sheet.json borders are logical 1x)', () => {
    const one = skinCssVariables('default')
    const two = skinCssVariables('retina')
    expect(one['--skin-panel-slice']).toBe('40 32 40 32 fill')
    expect(two['--skin-panel-slice']).toBe('80 64 80 64 fill')
    expect(one['--skin-btn-slice']).toBe('0 44 0 44 fill')
    expect(two['--skin-btn-slice']).toBe('0 88 0 88 fill')
  })

  it('maps every sprite variable to the matching PNG folder', () => {
    const vars = skinCssVariables('retina')
    for (const [key, value] of Object.entries(vars)) {
      if (key.endsWith('-slice')) continue
      expect(value, key).toMatch(/^url\("\/assets\/(png\/retina\/ui\/|ui_scene_background\.png)/)
    }
    expect(vars['--skin-btn-primary']).toContain('/menu/button_primary_normal.png')
    expect(vars['--skin-round-pressed']).toContain('/controls/button_round_pressed.png')
    expect(vars['--skin-health-fill-red']).toContain('/hud/health_fill_red.png')
  })
})
