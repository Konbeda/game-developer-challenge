/**
 * README section 8, item 1: navigation, validation and persistence of the options.
 * Runs in both projects (desktop and mobile landscape).
 */
import { STORAGE_KEYS } from '../../src/lib/storage.ts'
import {
  expect,
  readOptions,
  startMatch,
  test,
  writeStorageRaw,
  readStorageJson,
} from '../support/index.ts'

const SESSION_RANGE = /between 60 and 180 seconds/
const SPAWN_RANGE = /between 0\.5 and 10 seconds/
const SPAWN_STEP = /steps of 0\.1/

test.describe('Options: navigation and defaults', () => {
  test('menu -> Options -> Back, with labelled fields, hints and the default values', async ({
    app,
    page,
  }) => {
    await app.open()
    await app.openOptions()

    await expect(page.getByTestId('options-title')).toHaveText('Options')
    await expect(page.getByRole('spinbutton', { name: 'Game session time' })).toHaveValue('90')
    await expect(page.getByRole('spinbutton', { name: 'Enemy spawn time' })).toHaveValue('3')
    await expect(page.getByText('60-180 seconds')).toBeVisible()
    await expect(page.getByText(/0\.5-10 seconds, in steps of 0\.1/)).toBeVisible()

    // The spinbuttons expose their range to assistive technology.
    const session = app.options.input('session')
    await expect(session).toHaveAttribute('aria-valuemin', '60')
    await expect(session).toHaveAttribute('aria-valuemax', '180')
    await expect(session).toHaveAttribute('aria-valuenow', '90')
    const spawn = app.options.input('spawn')
    await expect(spawn).toHaveAttribute('aria-valuemin', '0.5')
    await expect(spawn).toHaveAttribute('aria-valuemax', '10')

    // Nothing was saved just by looking at the screen.
    expect(await readOptions(page)).toBeNull()

    await app.options.back.click()
    await expect(app.menu.root).toBeVisible()
    await expect(app.options.root).toBeHidden()
  })

  test('the steppers and the arrow keys move by 5 s and 0.1 s and stop at the limits', async ({
    app,
  }) => {
    await app.open()
    await app.openOptions()
    const { options } = app

    await options.increase('session').click()
    await options.expectValues('95', '3')
    await options.decrease('session').click()
    await options.decrease('session').click()
    await options.expectValues('85', '3')

    await options.increase('spawn').click()
    await options.expectValues('85', '3.1')
    await options.decrease('spawn').click()
    await options.decrease('spawn').click()
    await options.expectValues('85', '2.9')

    // Arrow keys inside the field do the same.
    await options.input('session').focus()
    await options.input('session').press('ArrowUp')
    await options.expectValues('90', '2.9')
    await options.input('spawn').focus()
    await options.input('spawn').press('ArrowDown')
    await options.expectValues('90', '2.8')

    // Limits: the round buttons disable, and the values stay in range.
    await options.fill('session', '180')
    await expect(options.increase('session')).toBeDisabled()
    await expect(options.decrease('session')).toBeEnabled()
    await options.fill('session', '60')
    await expect(options.decrease('session')).toBeDisabled()
    await options.fill('spawn', '10')
    await expect(options.increase('spawn')).toBeDisabled()
    await options.fill('spawn', '0.5')
    await expect(options.decrease('spawn')).toBeDisabled()
    await options.expectValues('60', '0.5')
  })
})

test.describe('Options: validation', () => {
  test('session time: below, above, empty, non-numeric and decimal values are rejected with accessible errors', async ({
    app,
    page,
  }) => {
    await app.open()
    await app.openOptions()
    const { options } = app
    const input = options.input('session')

    const invalid: [string, RegExp][] = [
      ['', /Enter a time between 60 and 180 seconds/],
      ['59', SESSION_RANGE],
      ['0', SESSION_RANGE],
      ['181', SESSION_RANGE],
      ['9999', SESSION_RANGE],
      ['abc', /Use whole seconds/],
      ['-5', /Use whole seconds/],
      ['90.5', /Use whole seconds/],
      ['1e2', /Use whole seconds/],
    ]
    for (const [text, message] of invalid) {
      await test.step(`"${text}" is rejected`, async () => {
        await options.fill('session', text)
        await expect(options.error('session')).toHaveText(message)
        await expect(input).toHaveAttribute('aria-invalid', 'true')
        // The error is wired to the field: aria-describedby points at the live region that holds it.
        const live = await options.describedByError('session')
        await expect(live).toContainText(message)
        await expect(live).toHaveAttribute('aria-live', 'polite')
        // Saving is refused and nothing is persisted.
        await options.save.click()
        await expect(options.error('session')).toBeVisible()
        await expect(options.status).not.toContainText('saved')
        expect(await readOptions(page)).toBeNull()
      })
    }

    // The boundaries themselves are valid (and surrounding spaces do not matter).
    for (const text of ['60', '180', ' 75 ']) {
      await options.fill('session', text)
      await expect(options.error('session')).toHaveCount(0)
      await expect(input).toHaveAttribute('aria-invalid', 'false')
    }
  })

  test('spawn time: below, above, empty, non-numeric and finer-than-0.1 values are rejected', async ({
    app,
    page,
  }) => {
    await app.open()
    await app.openOptions()
    const { options } = app
    const input = options.input('spawn')

    const invalid: [string, RegExp][] = [
      ['', /Enter a time between 0\.5 and 10 seconds/],
      ['0', SPAWN_RANGE],
      ['0.4', SPAWN_RANGE],
      ['10.1', SPAWN_RANGE],
      ['11', SPAWN_RANGE],
      ['0.05', SPAWN_STEP],
      ['2.55', SPAWN_STEP],
      ['1.234', SPAWN_STEP],
      ['abc', SPAWN_STEP],
      ['-1', SPAWN_STEP],
      ['2.5.5', SPAWN_STEP],
    ]
    for (const [text, message] of invalid) {
      await test.step(`"${text}" is rejected`, async () => {
        await options.fill('spawn', text)
        await expect(options.error('spawn')).toHaveText(message)
        await expect(input).toHaveAttribute('aria-invalid', 'true')
        const live = await options.describedByError('spawn')
        await expect(live).toContainText(message)
        await options.save.click()
        await expect(options.status).not.toContainText('saved')
        expect(await readOptions(page)).toBeNull()
      })
    }

    for (const text of ['0.5', '10', '2.5', '3.0', '1']) {
      await options.fill('spawn', text)
      await expect(options.error('spawn')).toHaveCount(0)
      await expect(input).toHaveAttribute('aria-invalid', 'false')
    }
  })

  test('both fields are validated together and fixing one keeps the other error', async ({
    app,
  }) => {
    await app.open()
    await app.openOptions()
    const { options } = app
    await options.fill('session', '10')
    await options.fill('spawn', '99')
    await options.save.click()
    await expect(options.error('session')).toBeVisible()
    await expect(options.error('spawn')).toBeVisible()

    await options.fill('session', '100')
    await expect(options.error('session')).toHaveCount(0)
    await expect(options.error('spawn')).toBeVisible()
  })
})

test.describe('Options: save and persistence', () => {
  test('Save stores the values, confirms it and survives a reload (comma accepted for decimals)', async ({
    app,
    page,
  }) => {
    await app.open()
    await app.openOptions()
    await app.options.saveValues('120', '2,5')

    await expect(app.options.status).toHaveText('Options saved.')
    // The comma was normalised in the field and the stored value is in milliseconds.
    await app.options.expectValues('120', '2.5')
    expect(await readOptions(page)).toEqual({ sessionSeconds: 120, spawnIntervalMs: 2500 })

    await app.reload()
    await app.openOptions()
    await app.options.expectValues('120', '2.5')

    // Editing again clears the "saved" confirmation until the next save.
    await app.options.fill('session', '125')
    await expect(app.options.status).not.toContainText('saved')
  })

  test('the saved options are the ones the ranking and the next match use', async ({
    app,
    page,
  }) => {
    await app.open()
    await app.openOptions()
    await app.options.saveValues('60', '3')
    await app.options.back.click()

    // 60 s / 3 s is a config the fixture players played, so the ranking has a table with a caption.
    await app.openLog('ranking')
    await expect(app.log.caption('ranking')).toHaveText(
      '60 second battles · 3 second spawn interval',
    )
    await app.log.mainMenu.click()

    await startMatch(page)
    await expect(app.game.time).toHaveText('01:00')
    expect(await page.evaluate(() => window.__game?.getHud().timeRemainingMs)).toBe(60_000)
  })

  test('each match takes a snapshot of the options as they were when it started', async ({
    app,
    page,
  }) => {
    await app.open({ config: { sessionSeconds: 60, spawnIntervalMs: 4000 } })
    await startMatch(page)
    await expect(app.game.time).toHaveText('01:00')
    await app.game.leaveToMenu()

    await app.openOptions()
    await app.options.saveValues('75', '4')
    await app.options.back.click()
    await startMatch(page)
    await expect(app.game.time).toHaveText('01:15')
  })

  test('an invalid Save keeps the previously saved options', async ({ app, page }) => {
    await app.open()
    await app.openOptions()
    await app.options.saveValues('100', '2')
    await expect(app.options.status).toHaveText('Options saved.')

    await app.options.saveValues('5', '2')
    await expect(app.options.error('session')).toBeVisible()
    expect(await readOptions(page)).toEqual({ sessionSeconds: 100, spawnIntervalMs: 2000 })
    await app.reload()
    await app.openOptions()
    await app.options.expectValues('100', '2')
  })

  test('Enter inside a field submits the form', async ({ app, page }) => {
    await app.open()
    await app.openOptions()
    await app.options.fill('session', '70')
    await app.options.input('session').press('Enter')
    await expect(app.options.status).toHaveText('Options saved.')
    expect((await readOptions(page))?.sessionSeconds).toBe(70)
  })

  test('tampered or corrupted stored options are ignored and the defaults are used', async ({
    app,
    page,
  }) => {
    const bad = [
      JSON.stringify({ sessionSeconds: 9999, spawnIntervalMs: 1 }),
      JSON.stringify({ sessionSeconds: 100, spawnIntervalMs: 2550 }),
      JSON.stringify({ sessionSeconds: 100, spawnIntervalMs: 2000, extra: '<img src=x>' }),
      '{not json',
    ]
    await app.open({ storage: { [STORAGE_KEYS.options]: bad[0]! } })
    for (const raw of bad) {
      await writeStorageRaw(page, STORAGE_KEYS.options, raw)
      await app.reload()
      await app.openOptions()
      await app.options.expectValues('90', '3')
      await app.options.back.click()
    }
  })
})

test.describe('Options: Defaults and Back', () => {
  test('Defaults refills the fields but only Save persists them', async ({ app, page }) => {
    await app.open()
    await app.openOptions()
    await app.options.saveValues('120', '2')
    await expect(app.options.status).toHaveText('Options saved.')

    await app.options.fill('session', '11')
    await expect(app.options.error('session')).toBeVisible()
    await app.options.defaults.click()
    await app.options.expectValues('90', '3')
    // Errors and the confirmation are cleared, the stored options are untouched.
    await expect(app.options.error('session')).toHaveCount(0)
    await expect(app.options.status).not.toContainText('saved')
    expect(await readOptions(page)).toEqual({ sessionSeconds: 120, spawnIntervalMs: 2000 })
    await app.reload()
    await app.openOptions()
    await app.options.expectValues('120', '2')

    await app.options.defaults.click()
    await app.options.save.click()
    await expect(app.options.status).toHaveText('Options saved.')
    expect(await readOptions(page)).toEqual({ sessionSeconds: 90, spawnIntervalMs: 3000 })
  })

  test('Back discards unsaved edits (stored options and the next visit are unchanged)', async ({
    app,
    page,
  }) => {
    await app.open()
    await app.openOptions()
    await app.options.fill('session', '100')
    await app.options.fill('spawn', '1.5')
    await app.options.back.click()
    await expect(app.menu.root).toBeVisible()

    expect(await readOptions(page)).toBeNull()
    await app.openOptions()
    await app.options.expectValues('90', '3')

    // With something already saved, unsaved edits do not replace it either.
    await app.options.saveValues('120', '2')
    await app.options.fill('session', '61')
    await app.options.back.click()
    await app.openOptions()
    await app.options.expectValues('120', '2')
    expect(await readStorageJson(page, STORAGE_KEYS.options)).toEqual({
      sessionSeconds: 120,
      spawnIntervalMs: 2000,
    })
  })
})
