/**
 * Textures the combat scene needs. Paths point at the challenge assets served from /assets.
 * Ships, effects and parts share one artwork resolution; only tiles/UI ship a 2x variant.
 */
const ROOT = '/assets/png'

export type ShipColor = 'white' | 'black' | 'red' | 'green' | 'blue' | 'yellow'

const SHIP_COLOR_INDEX: Record<ShipColor, number> = {
  white: 0,
  black: 1,
  red: 2,
  green: 3,
  blue: 4,
  yellow: 5,
}

/** Damage stages: 0 intact, 1 torn sails, 2 heavily damaged, 3 wreck. */
export type DamageStage = 0 | 1 | 2 | 3

/** ship_1..6 intact, 7..12 damaged, 13..18 heavily damaged, 19..24 wrecked (one per colour). */
export function shipTextureName(color: ShipColor, stage: DamageStage): string {
  return `ship_${stage * 6 + SHIP_COLOR_INDEX[color] + 1}`
}

const SHIP_NAMES = Array.from({ length: 24 }, (_, i) => `ship_${i + 1}`)
const EFFECT_NAMES = ['explosion_1', 'explosion_2', 'explosion_3', 'fire_1', 'fire_2']
const PART_NAMES = ['cannon_ball', 'wood_1', 'wood_2', 'wood_3', 'wood_4']
const TILE_NAMES = [
  'tile_73', // water
  'tile_68', // sand
  'tile_23', // grass
  'tile_24', // grass with flowers
  'tile_49',
  'tile_50',
  'tile_51', // rocks
  'tile_65',
  'tile_66',
  'tile_67', // mossy rocks
  'tile_70',
  'tile_71',
  'tile_72', // palms and plants
]
const HUD_NAMES = ['enemy_health_frame', 'enemy_health_fill_red', 'enemy_health_fill_green']

export const HEALTH_BAR = {
  /** Canvas of frame and fill (same size). */
  width: 160,
  height: 40,
  /** Area the fill occupies, clipped from the left. */
  fillX: 24,
  fillWidth: 112,
} as const

export interface AssetEntry {
  /** Alias used to look the texture up. */
  name: string
  url: string
  /** Extra scale applied to the texture resolution (2 for retina tiles). */
  resolution: number
}

export function buildManifest(retina: boolean): AssetEntry[] {
  const entry = (name: string, group: string, useRetina: boolean): AssetEntry => ({
    name,
    url: `${ROOT}/${useRetina && retina ? 'retina' : 'default'}/${group}/${name}.png`,
    resolution: useRetina && retina ? 2 : 1,
  })
  return [
    ...SHIP_NAMES.map((n) => entry(n, 'ships', false)),
    ...EFFECT_NAMES.map((n) => entry(n, 'effects', false)),
    ...PART_NAMES.map((n) => entry(n, 'ship_parts', false)),
    ...TILE_NAMES.map((n) => entry(n, 'tiles', true)),
    ...HUD_NAMES.map((n) => entry(n, 'ui/hud', false)),
  ]
}
