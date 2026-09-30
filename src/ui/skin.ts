/**
 * The ONE place that maps design-system pieces to sprites. Components and CSS never name a
 * sprite file: they use the CSS custom properties written by `applySkin()` and the helpers
 * exported here. A redesign is a swap of this module (and the token block in index.css).
 *
 * Sources: assets/spritesheet/ui_sheet.json (logical 1x units). Retina PNGs are the same art at
 * 2x, so every border/slice number below is multiplied by the variant scale.
 */

export type SkinVariant = 'default' | 'retina'

const ASSET_ROOT = '/assets'

/** Water/island scene shown behind every menu screen. */
const SCENE = 'ui_scene_background.png'

const UI_SPRITES = {
  panel: 'menu/panel_menu.png',
  title: 'menu/title_pirate_battle.png',
  buttonPrimary: 'menu/button_primary_normal.png',
  buttonPrimaryHover: 'menu/button_primary_hover.png',
  buttonPrimaryPressed: 'menu/button_primary_pressed.png',
  buttonPrimaryDisabled: 'menu/button_primary_disabled.png',
  buttonSecondary: 'menu/button_secondary_normal.png',
  buttonSecondaryPressed: 'menu/button_secondary_pressed.png',
  roundNormal: 'controls/button_round_normal.png',
  roundHover: 'controls/button_round_hover.png',
  roundPressed: 'controls/button_round_pressed.png',
  counterPanel: 'hud/counter_panel.png',
  healthFrame: 'hud/health_frame.png',
  healthFillGreen: 'hud/health_fill_green.png',
  healthFillAmber: 'hud/health_fill_amber.png',
  healthFillRed: 'hud/health_fill_red.png',
} as const

const ICON_SPRITES = {
  close: 'controls/icon_close.png',
  fireFront: 'controls/icon_fire_front.png',
  fireLeft: 'controls/icon_fire_left.png',
  fireRight: 'controls/icon_fire_right.png',
  forward: 'controls/icon_forward.png',
  home: 'controls/icon_home.png',
  minus: 'controls/icon_minus.png',
  pause: 'controls/icon_pause.png',
  play: 'controls/icon_play.png',
  plus: 'controls/icon_plus.png',
  restart: 'controls/icon_restart.png',
  settings: 'controls/icon_settings.png',
  turnLeft: 'controls/icon_turn_left.png',
  turnRight: 'controls/icon_turn_right.png',
  heart: 'hud/icon_heart.png',
  score: 'hud/icon_score.png',
  time: 'hud/icon_time.png',
} as const

export type SkinIconName = keyof typeof ICON_SPRITES
type UiSpriteName = keyof typeof UI_SPRITES

/** Non-UI sprites used by the menus (emblem shown in the main menu). */
const EMBLEM_PATH = 'png/default/ships/ship_2.png'

/** Logical (1x) 9-slice borders. Panel comes from ui_sheet.json; button caps are measured from the art. */
const SLICES = {
  panel: { top: 40, right: 32, bottom: 40, left: 32 },
  /** Buttons only stretch horizontally: the brass end caps are 44 logical px wide, full height. */
  buttonCap: 44,
} as const

/** Geometry of the health bar (ui_sheet.json `health_frame.layout`), logical px. */
export const HEALTH_BAR = {
  width: 256,
  height: 48,
  fill: { x: 30, y: 15, w: 196, h: 20 },
} as const

/** Logical size of the HUD counter panel sprite. */
export const COUNTER_PANEL = { width: 160, height: 56 } as const

/** Round buttons are 64 logical px with a 56 px visible ring. */
export const ROUND_BUTTON = { box: 64, visible: 56 } as const

let activeVariant: SkinVariant | null = null

export function pickVariant(dpr: number): SkinVariant {
  return dpr >= 1.5 ? 'retina' : 'default'
}

function variant(): SkinVariant {
  if (activeVariant) return activeVariant
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  activeVariant = pickVariant(dpr)
  return activeVariant
}

function uiUrl(name: UiSpriteName): string {
  return `${ASSET_ROOT}/png/${variant()}/ui/${UI_SPRITES[name]}`
}

export function skinIconUrl(name: SkinIconName): string {
  return `${ASSET_ROOT}/png/${variant()}/ui/${ICON_SPRITES[name]}`
}

export function skinTitleUrl(): string {
  return uiUrl('title')
}

export function skinEmblemUrl(): string {
  return `${ASSET_ROOT}/${EMBLEM_PATH}`
}

function cssUrl(url: string): string {
  return `url("${url}")`
}

/** All CSS custom properties that carry sprites/slices. Pure: easy to reason about and test. */
export function skinCssVariables(v: SkinVariant): Record<string, string> {
  const scale = v === 'retina' ? 2 : 1
  const url = (name: UiSpriteName) => cssUrl(`${ASSET_ROOT}/png/${v}/ui/${UI_SPRITES[name]}`)
  const p = SLICES.panel
  const cap = SLICES.buttonCap * scale
  return {
    '--skin-scene': cssUrl(`${ASSET_ROOT}/${SCENE}`),
    '--skin-panel': url('panel'),
    '--skin-panel-slice': `${p.top * scale} ${p.right * scale} ${p.bottom * scale} ${p.left * scale} fill`,
    '--skin-btn-slice': `0 ${cap} 0 ${cap} fill`,
    '--skin-btn-primary': url('buttonPrimary'),
    '--skin-btn-primary-hover': url('buttonPrimaryHover'),
    '--skin-btn-primary-pressed': url('buttonPrimaryPressed'),
    '--skin-btn-primary-disabled': url('buttonPrimaryDisabled'),
    '--skin-btn-secondary': url('buttonSecondary'),
    '--skin-btn-secondary-pressed': url('buttonSecondaryPressed'),
    '--skin-round': url('roundNormal'),
    '--skin-round-hover': url('roundHover'),
    '--skin-round-pressed': url('roundPressed'),
    '--skin-counter': url('counterPanel'),
    '--skin-health-frame': url('healthFrame'),
    '--skin-health-fill-green': url('healthFillGreen'),
    '--skin-health-fill-amber': url('healthFillAmber'),
    '--skin-health-fill-red': url('healthFillRed'),
  }
}

/** Keeps decoded sprites referenced so the browser cache is not dropped between screens. */
const preloaded: HTMLImageElement[] = []
let ready: Promise<void> = Promise.resolve()

function loadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => resolve() // a missing sprite must never block the UI
    img.src = src
    preloaded.push(img)
  })
}

/**
 * Writes the sprite variables on <html> and starts loading every sprite so hover/pressed states
 * never flash. Returns a promise that settles when they are all loaded (or failed).
 */
export function applySkin(): Promise<void> {
  const root = document.documentElement
  const v = variant()
  const vars = skinCssVariables(v)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  root.dataset['skin'] = v
  const urls = [
    ...(Object.keys(UI_SPRITES) as UiSpriteName[]).map(uiUrl),
    ...(Object.keys(ICON_SPRITES) as SkinIconName[]).map(skinIconUrl),
    skinEmblemUrl(),
    `${ASSET_ROOT}/${SCENE}`,
  ]
  ready = Promise.all(urls.map(loadImage)).then(() => undefined)
  return ready
}

/** Resolves when the skin sprites are loaded, or after `timeoutMs` (slow network): never blocks for long. */
export function whenSkinReady(timeoutMs = 4000): Promise<void> {
  return Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
}
