import { expect, test } from '../support/index.ts'

// README item 10: Ranking and Match History tabs — query, pagination, loading, empty and error.

test.describe('Captain’s Log: ranking', () => {
  test('lists the ranking of the current config, ordered, with pagination bounds', async ({
    app,
  }) => {
    await app.open()
    await app.openLog('ranking')
    await app.log.expectTable('ranking')

    // 27 fixtures for the default 90 s / 3 s config, 5 rows per page.
    await expect(app.log.rows('ranking')).toHaveCount(5)
    await expect(app.log.caption('ranking')).toContainText(/90 second battles/i)
    await expect(app.log.caption('ranking')).toContainText(/3 second spawn interval/i)
    await expect(app.log.pageStatus('ranking')).toContainText(/page 1 of 6/i)
    await expect(app.log.prev('ranking')).toBeDisabled()

    const first = await app.log.rankingRows()
    expect(first.map((row) => row.rank)).toEqual(['01', '02', '03', '04', '05'])
    const points = first.map((row) => row.points)
    expect(points).toEqual([...points].sort((a, b) => b - a))

    // Walk to the last page: next is disabled there, ranks keep counting.
    for (let page = 2; page <= 6; page++) {
      await app.log.next('ranking').click()
      await expect(app.log.pageStatus('ranking')).toContainText(
        new RegExp(`page ${page} of 6`, 'i'),
      )
    }
    await expect(app.log.next('ranking')).toBeDisabled()
    await expect(app.log.rows('ranking')).toHaveCount(2)
    const last = await app.log.rankingRows()
    expect(last.map((row) => row.rank)).toEqual(['26', '27'])

    await app.log.prev('ranking').click()
    await expect(app.log.pageStatus('ranking')).toContainText(/page 5 of 6/i)
  })

  test('the ranking follows the saved options (another config, another list)', async ({ app }) => {
    await app.open({ config: { sessionSeconds: 120, spawnIntervalMs: 3000 } })
    await app.openLog('ranking')
    await expect(app.log.caption('ranking')).toContainText(/120 second battles/i)
    await app.log.expectTable('ranking')
    // The 120 s / 3 s fixture set is smaller than the default one.
    await expect(app.log.pageStatus('ranking')).not.toContainText(/of 6/i)
  })

  test('shows the empty state when nobody has played the config', async ({ app }) => {
    await app.open({ scenario: 'empty' })
    await app.openLog('ranking')
    await expect(app.log.empty('ranking')).toBeVisible()
    await expect(app.log.table('ranking')).toBeHidden()
  })

  test('shows a loading state while the request is in flight', async ({ app }) => {
    await app.open({ scenario: 'slow', latencyMs: 1500 })
    await app.openLog('ranking')
    await expect(app.log.loading('ranking')).toBeVisible()
    await expect(app.log.loading('ranking')).toBeHidden({ timeout: 10_000 })
    await app.log.expectTable('ranking')
  })

  test.describe('failures', () => {
    test.use({ allowNetworkErrors: true })

    test('shows an accessible error with Retry that recovers once the API is healthy', async ({
      app,
      page,
    }) => {
      await app.open({ scenario: 'ranking_fails' })
      await app.openLog('ranking')
      await expect(app.log.error('ranking')).toBeVisible()
      await expect(app.log.error('ranking')).toHaveAttribute('role', 'alert')

      // The rest of the app keeps working while the ranking is down.
      await app.log.historyTab.click()
      await expect(app.log.error('ranking')).toBeHidden()

      await app.log.rankingTab.click()
      await expect(app.log.error('ranking')).toBeVisible()
      await app.backToMenu()
      await app.scenarios.select('success')
      await app.openLog('ranking')
      await app.log.expectTable('ranking')
      await expect(page.getByTestId('screen-log')).toBeVisible()
    })

    test('HTTP 5xx and connection failures both surface as errors', async ({ app }) => {
      await app.open({ scenario: 'http_5xx' })
      await app.openLog('ranking')
      await expect(app.log.error('ranking')).toBeVisible()
      await app.log.historyTab.click()
      await expect(app.log.error('history')).toBeVisible()

      await app.backToMenu()
      await app.scenarios.select('network_error')
      await app.openLog('ranking')
      await expect(app.log.error('ranking')).toBeVisible()
    })
  })

  test('keyboard: the tabs respond to the arrow keys', async ({ app, page }) => {
    await app.open()
    await app.openLog('ranking')
    await app.log.rankingTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(app.log.historyTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(app.log.rankingTab).toHaveAttribute('aria-selected', 'true')
  })

  test('paging quickly with out-of-order answers ends on the last selected page', async ({
    app,
  }) => {
    await app.open({ scenario: 'out_of_order', latencyMs: null })
    await app.openLog('ranking')
    await app.log.expectTable('ranking')
    for (let i = 0; i < 4; i++) await app.log.next('ranking').click()
    await expect(app.log.pageStatus('ranking')).toContainText(/page 5 of 6/i)
    // Give every in-flight answer time to land, then check the table still matches page 5.
    await expect
      .poll(async () => (await app.log.rankingRows()).map((r) => r.rank)[0], { timeout: 15_000 })
      .toBe('21')
    await expect(app.log.pageStatus('ranking')).toContainText(/page 5 of 6/i)
  })
})

test.describe('Captain’s Log: match history', () => {
  test('shows the empty state before any match and the many-pages synthetic history', async ({
    app,
  }) => {
    await app.open()
    await app.openLog('history')
    await expect(app.log.empty('history')).toBeVisible()

    await app.backToMenu()
    await app.scenarios.select('many_pages')
    await app.openLog('history')
    await app.log.expectTable('history')
    await expect(app.log.rows('history')).toHaveCount(5)
    await expect(app.log.pageStatus('history')).toContainText(/page 1 of 7/i)
    await app.log.next('history').click()
    await expect(app.log.pageStatus('history')).toContainText(/page 2 of 7/i)
    await expect(app.log.prev('history')).toBeEnabled()
  })

  test.describe('failures', () => {
    test.use({ allowNetworkErrors: true })

    test('history_fails shows an error with Retry while the ranking still loads', async ({
      app,
    }) => {
      await app.open({ scenario: 'history_fails' })
      await app.openLog('history')
      await expect(app.log.error('history')).toBeVisible()
      await app.log.rankingTab.click()
      await app.log.expectTable('ranking')
    })
  })
})
