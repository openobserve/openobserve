const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const isHistoryCall = (method) => (res) =>
  res.url().includes('/query_history') && res.request().method() === method;

/** Type a query and Run it, resolving once the history POST has landed. */
async function runAndRecord(page, pm, query) {
  await pm.metricsPage.enterMetricsQuery(query);
  await expect
    .poll(() => pm.metricsQueryEditorPage.getCurrentQueryText(), { timeout: 10000 })
    .toBe(query);
  // The editor commits its text on a 500ms debounce; an earlier Run records nothing.
  await page.waitForTimeout(600);
  const recorded = page.waitForResponse(isHistoryCall('POST'), { timeout: 30000 });
  await pm.metricsPage.clickApplyButton();
  expect((await recorded).ok(), `history POST for ${query}`).toBe(true);
}

test.describe('Metrics editor query history', () => {
  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('Run records an entry; star it; load it back into the editor', {
    tag: ['@metrics', '@queryHistory', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const metrics = pm.metricsPage;

    // Unique per run, so the entry is ours whatever history the user already has.
    const marker = Date.now();
    const first = `cpu_usage + ${marker}`;
    const second = `memory_usage + ${marker}`;

    await metrics.gotoMetricsPage();
    // Custom mode first: a Builder entry reloads by regenerating the query from its fields.
    const custom = metrics.customQueryTypeButton.first();
    await expect(custom).toBeVisible({ timeout: 15000 });
    await custom.click();
    await expect(custom).toHaveAttribute('data-state', 'on');
    await runAndRecord(page, pm, first);
    await runAndRecord(page, pm, second);

    await metrics.openQueryHistory();
    await metrics.searchQueryHistory(String(marker));
    await expect(metrics.historyRow(first)).toHaveCount(1, { timeout: 15000 });
    await expect(metrics.historyRow(second)).toHaveCount(1, { timeout: 15000 });

    // Star one: the toggle flips, and "starred only" keeps it and drops the unstarred one.
    const starred = page.waitForResponse(isHistoryCall('PATCH'));
    await metrics.historyStarButton(first).click();
    expect((await starred).ok()).toBe(true);
    await expect(metrics.historyStarButton(first)).toHaveAttribute('aria-label', 'Unstar');
    const starredOnlyBox = metrics.historyStarredOnly.locator('[role="checkbox"]');
    // The new filter shows a skeleton until its list answers, and a skeleton has no rows to find.
    const starredList = page.waitForResponse(
      (res) => {
        const params = new URL(res.url()).searchParams;
        return isHistoryCall('GET')(res) && params.get('starred') === 'true' && !params.has('count_only');
      },
      { timeout: 30000 },
    );
    await metrics.historyStarredOnly.click();
    await expect(starredOnlyBox).toHaveAttribute('aria-checked', 'true');
    const starredRows = await (await starredList).json();
    expect(starredRows.map((row) => row.query)).toContain(first);
    expect(starredRows.map((row) => row.query)).not.toContain(second);
    await expect(metrics.historyRow(first)).toHaveCount(1, { timeout: 15000 });
    await expect(metrics.historyRow(second)).toHaveCount(0);
    await metrics.historyStarredOnly.click();
    await expect(starredOnlyBox).toHaveAttribute('aria-checked', 'false');
    await expect(metrics.historyRow(second)).toHaveCount(1, { timeout: 15000 });

    // The editor holds the second query; load the starred entry back in place.
    await metrics.loadHistoryEntry(first);
    await expect(metrics.historyDrawer).toBeHidden();
    await expect
      .poll(() => pm.metricsQueryEditorPage.getCurrentQueryText(), { timeout: 15000 })
      .toBe(first);

    // Starred entries are never reaped, so remove this run's from the user's history.
    await metrics.openQueryHistory();
    for (const query of [first, second]) {
      // The DELETE waits for the row's 6s Undo toast to close.
      const deleted = page.waitForResponse(isHistoryCall('DELETE'), { timeout: 30000 });
      await metrics.deleteHistoryEntry(query);
      expect((await deleted).ok()).toBe(true);
      await expect(metrics.historyRow(query)).toHaveCount(0, { timeout: 15000 });
    }
  });
});
