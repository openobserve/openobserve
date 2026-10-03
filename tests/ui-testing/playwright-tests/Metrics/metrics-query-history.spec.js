/**
 * Metrics editor — PromQL query history.
 *
 * An explicit Run in `/metrics/editor` records the query on the server
 * (POST /api/{org}/query_history). The History drawer lists the caller's
 * entries newest first; an entry can be starred (kept past retention) and
 * clicked to load it back into the open editor without a remount.
 *
 * Feature: metrics-explore-features §5 (tmp/metrics_explore_features_spec.md)
 */
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
  // The editor commits its text to the panel model on a 500ms debounce; Run
  // before that validates an empty query and records nothing.
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
    // Custom mode before typing: an entry recorded in Builder mode reloads as
    // Builder, which regenerates the query from its fields instead of restoring it.
    const custom = metrics.customQueryTypeButton.first();
    await expect(custom).toBeVisible({ timeout: 15000 });
    await custom.click();
    await expect(custom).toHaveAttribute('data-state', 'on');
    await runAndRecord(page, pm, first);

    await metrics.openQueryHistory();
    await metrics.searchQueryHistory(String(marker));
    await expect(metrics.historyRow(first)).toHaveCount(1, { timeout: 15000 });

    // Star it: the toggle flips, and the entry survives "starred only".
    const starred = page.waitForResponse(isHistoryCall('PATCH'));
    await metrics.historyStarButton(first).click();
    expect((await starred).ok()).toBe(true);
    await expect(metrics.historyStarButton(first)).toHaveAttribute('aria-label', 'Unstar');
    await metrics.historyStarredOnly.click();
    await expect(metrics.historyRow(first)).toHaveCount(1, { timeout: 15000 });
    await metrics.historyStarredOnly.click();
    await page.keyboard.press('Escape');
    await expect(metrics.historyTable).toBeHidden();

    // Replace the editor's query, then load the starred entry back in place.
    await runAndRecord(page, pm, second);
    await metrics.openQueryHistory();
    await expect(metrics.historyRow(second)).toHaveCount(1, { timeout: 15000 });
    await metrics.loadHistoryEntry(first);
    await expect(metrics.historyTable).toBeHidden();
    await expect
      .poll(() => pm.metricsQueryEditorPage.getCurrentQueryText(), { timeout: 15000 })
      .toBe(first);

    // Starred entries are never reaped, so remove this run's from the user's history.
    await metrics.openQueryHistory();
    for (const query of [first, second]) {
      const deleted = page.waitForResponse(isHistoryCall('DELETE'));
      await metrics.deleteHistoryEntry(query);
      expect((await deleted).ok()).toBe(true);
      await expect(metrics.historyRow(query)).toHaveCount(0, { timeout: 15000 });
    }
  });
});
