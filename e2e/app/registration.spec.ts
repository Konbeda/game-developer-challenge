import {
  EMPTY_BOARD_CONFIG,
  expect,
  finishMatch,
  playMatchToResult,
  readConfirmedRecords,
  readLastResult,
  readOutbox,
  startMatch,
  test,
  waitForOutboxIdle,
} from '../support/index.ts'

// README items 8, 11 and 12: result screen, registration, pending recovery, resend without duplicates.

test.describe('Result screen', () => {
  test('shows score, time, reason and record status, and survives a refresh', async ({ app }) => {
    await app.open({ config: EMPTY_BOARD_CONFIG })
    const submission = await playMatchToResult(app.page)

    await expect(app.result.score).toHaveText(String(submission.score))
    await expect(app.result.reason).toBeVisible()
    await expect(app.result.time).toBeVisible()
    await app.result.expectStatus('synced')

    // A refresh abandons the (finished) result screen: the app starts on the menu, which carries the
    // last completed match with the same data.
    await app.reload()
    await expect(app.menu.root).toBeVisible()
    await expect(app.menu.lastMatch).toBeVisible()
    await expect(app.menu.lastMatchScore).toContainText(String(submission.score))
    const persisted = await readLastResult(app.page)
    expect(persisted?.matchId).toBe(submission.matchId)
  })

  test('Play Again starts a clean match with the current options; Main Menu returns', async ({
    app,
    page,
  }) => {
    await app.open({ config: EMPTY_BOARD_CONFIG })
    const first = await playMatchToResult(page)
    await app.result.playAgain.click()
    await expect(app.game.root).toBeVisible()
    await page.waitForFunction(() => window.__game?.getHud().phase === 'running')
    const hud = await page.evaluate(() => window.__game?.getHud())
    expect(hud?.score).toBe(0)
    expect(hud?.playerHealth).toBe(hud?.playerMaxHealth)
    expect(hud?.timeRemainingMs).toBeGreaterThan((EMPTY_BOARD_CONFIG.sessionSeconds - 2) * 1000)

    const second = await finishMatch(page)
    expect(second.matchId).not.toBe(first.matchId)
    await app.result.mainMenu.click()
    await expect(app.menu.root).toBeVisible()
  })
})

test.describe('Match registration', () => {
  test('a finished match appears in Ranking and Match History without reloading', async ({
    app,
  }) => {
    await app.open({ config: EMPTY_BOARD_CONFIG, name: 'Tester' })
    const submission = await playMatchToResult(app.page)
    await app.result.expectStatus('synced')
    await app.result.mainMenu.click()

    await app.openLog('ranking')
    await app.log.expectTable('ranking')
    const ranking = await app.log.rankingRows()
    expect(ranking).toHaveLength(1)
    expect(ranking[0]).toMatchObject({
      rank: '01',
      name: expect.stringContaining('Tester'),
      you: true,
    })
    expect(ranking[0]?.points).toBe(submission.score)

    await app.log.historyTab.click()
    await app.log.expectTable('history')
    const history = await app.log.historyRows()
    expect(history).toHaveLength(1)
    expect(history[0]?.score).toBe(submission.score)

    const confirmed = await readConfirmedRecords(app.page)
    expect(confirmed.filter((r) => r.matchId === submission.matchId)).toHaveLength(1)
  })

  test('the ranking is scoped by config: another config does not list the match', async ({
    app,
  }) => {
    await app.open({ config: EMPTY_BOARD_CONFIG })
    await playMatchToResult(app.page)
    await app.result.expectStatus('synced')
    await app.result.mainMenu.click()

    // Same player, default config: the 60 s / 2.5 s match must not be in that ranking...
    await app.openOptions()
    await app.options.saveValues('90', '3')
    await app.options.back.click()
    await app.openLog('ranking')
    await app.log.expectTable('ranking')
    const rows = await app.log.rankingRows()
    expect(rows.some((row) => row.you)).toBe(false)
    // ...but it is in the player's history, whatever the config.
    await app.log.historyTab.click()
    await expect(app.log.rows('history')).toHaveCount(1)
  })

  test.describe('outage at match end', () => {
    test.use({ allowNetworkErrors: true })

    test('the record stays pending across a refresh and registers once after recovery', async ({
      app,
      page,
    }) => {
      await app.open({ scenario: 'submit_outage', config: EMPTY_BOARD_CONFIG })
      const submission = await playMatchToResult(page)
      await app.result.expectStatus('failed')
      await expect(app.result.retry).toBeVisible()

      // Persisted before/after the failed send, survives a reload.
      expect((await readOutbox(page)).map((e) => e.submission.matchId)).toContain(
        submission.matchId,
      )
      await app.reload()
      await expect(app.menu.root).toBeVisible()
      expect((await readOutbox(page)).map((e) => e.submission.matchId)).toContain(
        submission.matchId,
      )

      // The player can keep playing while the record is pending.
      await startMatch(page)
      const second = await finishMatch(page)
      expect(second.matchId).not.toBe(submission.matchId)
      await app.result.mainMenu.click()

      // API recovers: both records register, exactly once each.
      await app.scenarios.select('success')
      await expect
        .poll(async () => (await readConfirmedRecords(page)).length, { timeout: 60_000 })
        .toBe(2)
      await waitForOutboxIdle(page)
      const confirmed = await readConfirmedRecords(page)
      expect(new Set(confirmed.map((r) => r.matchId)).size).toBe(2)

      await app.openLog('history')
      await expect(app.log.rows('history')).toHaveCount(2)
    })

    test('manual Retry from the result screen registers the match once', async ({ app, page }) => {
      await app.open({ scenario: 'submit_outage', config: EMPTY_BOARD_CONFIG })
      const submission = await playMatchToResult(page)
      await app.result.expectStatus('failed')

      await app.result.mainMenu.click()
      await app.scenarios.select('success')
      await expect(app.menu.lastMatchRetry).toBeVisible()
      await app.menu.lastMatchRetry.click()
      await expect
        .poll(async () => (await readConfirmedRecords(page)).length, { timeout: 30_000 })
        .toBe(1)
      await waitForOutboxIdle(page)
      const confirmed = await readConfirmedRecords(page)
      expect(confirmed[0]?.matchId).toBe(submission.matchId)
    })
  })

  test.describe('timeout after commit', () => {
    test.use({ allowNetworkErrors: true })

    test('a resend after the timeout does not duplicate the record (even with repeated clicks)', async ({
      app,
      page,
    }) => {
      await app.open({
        scenario: 'submit_timeout_after_commit',
        timeoutMs: 400,
        config: EMPTY_BOARD_CONFIG,
      })
      const submission = await playMatchToResult(page)
      // The server committed the record but the answer never arrived in time.
      await expect(app.result.sync).not.toHaveAttribute('data-status', 'synced')

      await expect
        .poll(async () => (await readConfirmedRecords(page)).length, { timeout: 15_000 })
        .toBe(1)
      await expect(app.result.sync).toHaveAttribute('data-status', /failed|pending|syncing|synced/)

      // Hammer Retry: still exactly one record everywhere.
      for (let i = 0; i < 3; i++) {
        if (await app.result.retry.isVisible()) await app.result.retry.click({ noWaitAfter: true })
      }
      await app.result.expectStatus('synced')
      await waitForOutboxIdle(page)

      const confirmed = await readConfirmedRecords(page)
      expect(confirmed.filter((r) => r.matchId === submission.matchId)).toHaveLength(1)

      await app.result.mainMenu.click()
      await app.openLog('history')
      await expect(app.log.rows('history')).toHaveCount(1)
      await app.log.rankingTab.click()
      await expect(app.log.rows('ranking')).toHaveCount(1)
    })
  })
})
