import { expect, type Locator, type Page } from '@playwright/test'
import type { ScenarioId } from '../../src/contracts/scenarios.ts'

/** Locators are lazy: they re-resolve on every assertion, so they are safe across re-renders. */

export class MenuPage {
  readonly root: Locator
  readonly play: Locator
  readonly options: Locator
  readonly ranking: Locator
  readonly history: Locator
  readonly playerName: Locator
  readonly changeName: Locator
  readonly lastMatch: Locator
  readonly lastMatchScore: Locator
  readonly lastMatchTime: Locator
  readonly lastMatchReason: Locator
  readonly lastMatchSync: Locator
  readonly lastMatchRetry: Locator
  readonly lastMatchEmpty: Locator
  readonly controls: Locator

  constructor(readonly page: Page) {
    this.root = page.getByTestId('screen-menu')
    this.play = page.getByTestId('menu-play')
    this.options = page.getByTestId('menu-options')
    this.ranking = page.getByTestId('menu-ranking')
    this.history = page.getByTestId('menu-history')
    this.playerName = page.getByTestId('player-name')
    this.changeName = page.getByTestId('change-name')
    this.lastMatch = page.getByTestId('last-match')
    this.lastMatchScore = page.getByTestId('last-match-score')
    this.lastMatchTime = page.getByTestId('last-match-time')
    this.lastMatchReason = page.getByTestId('last-match-reason')
    this.lastMatchSync = page.getByTestId('last-match-sync')
    this.lastMatchRetry = page.getByTestId('last-match-sync-retry')
    this.lastMatchEmpty = page.getByTestId('last-match-empty')
    this.controls = page.getByTestId('controls-list')
  }

  async expectVisible(): Promise<void> {
    await expect(this.root).toBeVisible()
  }
}

export type OptionsField = 'session' | 'spawn'

export class OptionsPage {
  readonly root: Locator
  readonly form: Locator
  readonly save: Locator
  readonly defaults: Locator
  readonly back: Locator
  readonly status: Locator

  constructor(readonly page: Page) {
    this.root = page.getByTestId('screen-options')
    this.form = page.getByTestId('options-form')
    this.save = page.getByTestId('options-save')
    this.defaults = page.getByTestId('options-defaults')
    this.back = page.getByTestId('options-back')
    this.status = page.getByTestId('options-status')
  }

  input(field: OptionsField): Locator {
    return this.page.getByTestId(`options-${field}-input`)
  }

  /** The visible error paragraph of a field (absent while the field is valid). */
  error(field: OptionsField): Locator {
    return this.page.getByTestId(`options-${field}-error`)
  }

  increase(field: OptionsField): Locator {
    return this.page.getByTestId(`options-${field}-increase`)
  }

  decrease(field: OptionsField): Locator {
    return this.page.getByTestId(`options-${field}-decrease`)
  }

  /** Replaces the field's text (as typed by a player, one `input` event per character is not needed). */
  async fill(field: OptionsField, value: string): Promise<void> {
    await this.input(field).fill(value)
  }

  /** Fills both fields and presses Save. */
  async saveValues(session: string, spawn: string): Promise<void> {
    await this.fill('session', session)
    await this.fill('spawn', spawn)
    await this.save.click()
  }

  async expectValues(session: string, spawn: string): Promise<void> {
    await expect(this.input('session')).toHaveValue(session)
    await expect(this.input('spawn')).toHaveValue(spawn)
  }

  /**
   * The element an input's `aria-describedby` points at for errors: its text must be the field's
   * error message. Returns the locator of that live region.
   */
  async describedByError(field: OptionsField): Promise<Locator> {
    const ids = ((await this.input(field).getAttribute('aria-describedby')) ?? '').split(' ')
    const errorId = ids[ids.length - 1] ?? ''
    return this.page.locator(`[id="${errorId}"]`)
  }
}

export class LogPage {
  readonly root: Locator
  readonly rankingTab: Locator
  readonly historyTab: Locator
  readonly mainMenu: Locator

  constructor(readonly page: Page) {
    this.root = page.getByTestId('screen-log')
    this.rankingTab = page.getByTestId('tab-ranking')
    this.historyTab = page.getByTestId('tab-history')
    this.mainMenu = page.getByTestId('log-main-menu')
  }

  /** Test id prefix of the table region of a tab. */
  private prefix(tab: LogTabName): string {
    return tab
  }

  loading(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-loading`)
  }
  empty(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-empty`)
  }
  error(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-error`)
  }
  retry(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-error-retry`)
  }
  table(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-table`)
  }
  rows(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-row`)
  }
  prev(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-pagination-prev`)
  }
  next(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-pagination-next`)
  }
  pageStatus(tab: LogTabName): Locator {
    return this.page.getByTestId(`${this.prefix(tab)}-pagination-status`)
  }
  caption(tab: LogTabName): Locator {
    return this.table(tab).locator('caption')
  }

  /** Visible ranking rows as `{ rank, name, points, you }`. */
  async rankingRows(): Promise<{ rank: string; name: string; points: number; you: boolean }[]> {
    return this.rows('ranking').evaluateAll((rows) =>
      rows.map((row) => ({
        rank: row.querySelector('[data-testid="ranking-rank"]')?.textContent?.trim() ?? '',
        name: row.querySelector('[data-testid="ranking-name"]')?.textContent?.trim() ?? '',
        points: Number(row.querySelector('[data-testid="ranking-points"]')?.textContent),
        you: row.getAttribute('data-highlight') === 'true',
      })),
    )
  }

  /** Visible history rows as `{ score, duration, reason, highlighted }` (newest first). */
  async historyRows(): Promise<
    { score: number; duration: string; reason: string; highlighted: boolean }[]
  > {
    return this.rows('history').evaluateAll((rows) =>
      rows.map((row) => ({
        score: Number(row.querySelector('[data-testid="history-score"]')?.textContent),
        duration: row.querySelector('[data-testid="history-duration"]')?.textContent?.trim() ?? '',
        reason: row.querySelector('[data-testid="history-reason"]')?.textContent?.trim() ?? '',
        highlighted: row.getAttribute('data-highlight') === 'true',
      })),
    )
  }

  /** Waits for the tab's table (or empty/error state is not accepted: a table must render). */
  async expectTable(tab: LogTabName): Promise<void> {
    await expect(this.table(tab)).toBeVisible()
  }
}

export type LogTabName = 'ranking' | 'history'

export class GamePage {
  readonly root: Locator
  readonly loading: Locator
  readonly loadingPercent: Locator
  readonly progress: Locator
  readonly error: Locator
  readonly retry: Locator
  readonly errorMenu: Locator
  readonly hud: Locator
  readonly score: Locator
  readonly time: Locator
  readonly pause: Locator
  readonly pauseDialog: Locator
  readonly resume: Locator
  readonly restart: Locator
  readonly pauseMainMenu: Locator
  readonly canvas: Locator
  readonly touchControls: Locator

  constructor(readonly page: Page) {
    this.root = page.getByTestId('screen-game')
    this.loading = page.getByTestId('game-loading')
    this.loadingPercent = page.getByTestId('game-loading-percent')
    this.progress = this.loading.getByRole('progressbar')
    this.error = page.getByTestId('game-error')
    this.retry = page.getByTestId('game-error-retry')
    this.errorMenu = page.getByTestId('game-error-menu')
    this.hud = page.getByTestId('hud')
    this.score = page.getByTestId('hud-score')
    this.time = page.getByTestId('hud-time')
    this.pause = page.getByTestId('hud-pause')
    this.pauseDialog = page.getByTestId('pause-dialog')
    this.resume = page.getByTestId('pause-resume')
    this.restart = page.getByTestId('pause-restart')
    this.pauseMainMenu = page.getByTestId('pause-main-menu')
    this.canvas = page.locator('canvas')
    this.touchControls = page.getByTestId('touch-controls')
  }

  /** `data-phase` of the game screen: loading-independent phase mirrored from the host. */
  phase(): Promise<string | null> {
    return this.root.getAttribute('data-phase')
  }

  /** Leaves an ongoing match through Pause -> Main menu (abandons it). */
  async leaveToMenu(): Promise<void> {
    await this.pause.click()
    await expect(this.pauseDialog).toBeVisible()
    await this.pauseMainMenu.click()
    await expect(this.page.getByTestId('screen-menu')).toBeVisible()
  }
}

export class ResultPage {
  readonly root: Locator
  readonly score: Locator
  readonly time: Locator
  readonly reason: Locator
  readonly sync: Locator
  readonly badge: Locator
  readonly retry: Locator
  readonly playAgain: Locator
  readonly mainMenu: Locator

  constructor(readonly page: Page) {
    this.root = page.getByTestId('screen-result')
    this.score = page.getByTestId('result-score')
    this.time = page.getByTestId('result-time')
    this.reason = page.getByTestId('result-reason')
    this.sync = page.getByTestId('result-sync')
    this.badge = page.getByTestId('result-sync-badge')
    this.retry = page.getByTestId('result-sync-retry')
    this.playAgain = page.getByTestId('result-play-again')
    this.mainMenu = page.getByTestId('result-main-menu')
  }

  /** Waits for a given record status (`pending | syncing | synced | failed`). */
  async expectStatus(status: 'pending' | 'syncing' | 'synced' | 'failed'): Promise<void> {
    await expect(this.sync).toHaveAttribute('data-status', status)
  }
}

export class NameDialog {
  readonly root: Locator
  readonly input: Locator
  readonly submit: Locator
  readonly skip: Locator
  readonly error: Locator

  constructor(readonly page: Page) {
    this.root = page.getByTestId('name-dialog')
    this.input = page.getByTestId('name-input')
    this.submit = page.getByTestId('name-submit')
    this.skip = page.getByTestId('name-skip')
    this.error = page.getByTestId('name-error')
  }
}

/** The developer panel that selects the network scenario (menu footer and Options screen). */
export class ScenarioPanel {
  readonly trigger: Locator
  readonly dialog: Locator
  readonly message: Locator
  readonly close: Locator
  readonly reset: Locator

  constructor(readonly page: Page) {
    this.trigger = page.getByTestId('scenarios-open')
    this.dialog = page.getByTestId('scenarios-dialog')
    this.message = page.getByTestId('scenarios-message')
    this.close = page.getByTestId('scenarios-close')
    this.reset = page.getByTestId('scenarios-reset')
  }

  radio(id: ScenarioId): Locator {
    return this.page.getByTestId(`scenario-${id}`)
  }

  /** Opens the panel (from the menu or Options), picks a scenario and closes the panel again. */
  async select(id: ScenarioId): Promise<void> {
    await this.trigger.click()
    await expect(this.dialog).toBeVisible()
    await this.radio(id).check()
    await expect(this.radio(id)).toBeChecked()
    await this.close.click()
    await expect(this.dialog).toBeHidden()
  }

  /** Opens the panel, confirms "Reset mocks" and closes it. */
  async resetMocks(): Promise<void> {
    await this.trigger.click()
    await expect(this.dialog).toBeVisible()
    await this.reset.click()
    await this.page.getByTestId('scenarios-reset-yes').click()
    await expect(this.message).toContainText('Mocks reset')
    await this.close.click()
    await expect(this.dialog).toBeHidden()
  }
}

/** Every page object of the app around one Playwright page. */
export class App {
  readonly menu: MenuPage
  readonly options: OptionsPage
  readonly log: LogPage
  readonly game: GamePage
  readonly result: ResultPage
  readonly nameDialog: NameDialog
  readonly scenarios: ScenarioPanel

  constructor(readonly page: Page) {
    this.menu = new MenuPage(page)
    this.options = new OptionsPage(page)
    this.log = new LogPage(page)
    this.game = new GamePage(page)
    this.result = new ResultPage(page)
    this.nameDialog = new NameDialog(page)
    this.scenarios = new ScenarioPanel(page)
  }

  /** Main menu -> Ranking or Match History tab. */
  async openLog(tab: LogTabName): Promise<void> {
    await (tab === 'ranking' ? this.menu.ranking : this.menu.history).click()
    await expect(this.log.root).toBeVisible()
  }

  /** Any screen with a "Main menu" action -> menu (log and result screens). */
  async backToMenu(): Promise<void> {
    const candidates = [this.log.mainMenu, this.result.mainMenu, this.options.back]
    for (const button of candidates) {
      if (await button.isVisible()) {
        await button.click()
        break
      }
    }
    await expect(this.menu.root).toBeVisible()
  }

  async openOptions(): Promise<void> {
    await this.menu.options.click()
    await expect(this.options.root).toBeVisible()
  }
}
