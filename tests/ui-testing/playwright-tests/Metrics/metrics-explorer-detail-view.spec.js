/**
 * Metrics Explorer — metric detail view: Breakdown and Related tabs.
 *
 * A card's Details button opens one metric in detail (driven by the URL's
 * `metric` param). Breakdown ranks the metric's labels by top values and charts
 * the metric grouped by the selected label; Related lists nearby metrics by
 * name, and opening one navigates to its own detail view.
 *
 * Feature: metrics-explore-features §2–3 (tmp/metrics_explore_features_spec.md)
 *
 * Seeds its own deterministic metrics (metrics-explore-seed.js): the shared OTLP
 * seed draws label values at random, so it cannot pin status="500".
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  DETAIL_METRIC,
  RELATED_METRIC,
  seedDetailMetrics,
} = require('../utils/metrics-explore-seed.js');

/** Narrows the grid to the seeded `e2e_mef_http_*` trio, so their cards render. */
const PREFIX_SEARCH = 'e2e_mef_http_';

test.describe('Metrics Explorer detail view', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ request }) => {
    await seedDetailMetrics(request);
  });

  async function openDetail(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const explorer = pm.metricsExplorerPage;
    await explorer.gotoExplorer({ search: PREFIX_SEARCH });
    await expect(explorer.cardRoot(DETAIL_METRIC)).toBeVisible({ timeout: 60000 });
    await explorer.openMetricDetails(DETAIL_METRIC);
    await explorer.expectDetailOpen(DETAIL_METRIC);
    return explorer;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('Breakdown: select a label → chart and value table; Add to filter adds a chip; Back returns to the grid', {
    tag: ['@metrics', '@metrics-explorer', '@breakdown', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    const explorer = await openDetail(page, testInfo);

    await explorer.selectDetailTab('breakdown');
    await expect(explorer.breakdownRow('method')).toBeVisible({ timeout: 30000 });

    // method has two values, so its chart needs no topk guard.
    await explorer.selectBreakdownLabel('method');
    const chart = page.locator(explorer.breakdownChart);
    await expect(chart.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(chart.locator(explorer.breakdownTopk)).toHaveCount(0);

    await expect(explorer.breakdownValue('method', 'GET')).toBeVisible();
    await expect(explorer.breakdownValue('method', 'POST')).toBeVisible();
    await expect(explorer.breakdownDistinct('method')).toHaveText('2');

    // Add status = 500: a chip appears, and the table re-queries under the filter.
    await expect(explorer.breakdownValue('status', '200')).toBeVisible();
    await explorer.addBreakdownFilter('status', '500');
    await expect(explorer.labelChip('status')).toBeVisible({ timeout: 15000 });
    await expect(explorer.labelChip('status')).toContainText('500');
    await expect(explorer.breakdownValue('status', '200')).toHaveCount(0, { timeout: 30000 });
    await expect(explorer.breakdownValue('status', '500')).toBeVisible();

    await explorer.closeDetail();
    await expect(page.locator(explorer.detailRoot)).toHaveCount(0, { timeout: 15000 });
    await explorer.expectGridVisible();
    await expect.poll(() => explorer.getQueryParam('metric'), { timeout: 15000 }).toBeNull();
    await expect(explorer.cardRoot(DETAIL_METRIC)).toBeVisible({ timeout: 30000 });
  });

  test('Related: lists same-prefix metrics; opening one navigates, and Back returns to the first', {
    tag: ['@metrics', '@metrics-explorer', '@related', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    const explorer = await openDetail(page, testInfo);

    await explorer.selectDetailTab('related');
    await expect(explorer.relatedRow(RELATED_METRIC)).toBeVisible({ timeout: 30000 });
    // The metric never lists itself.
    await expect(explorer.relatedRow(DETAIL_METRIC)).toHaveCount(0);

    await explorer.relatedRow(RELATED_METRIC).locator('[data-test="o2-table-cell-name"]').click();
    await explorer.expectDetailOpen(RELATED_METRIC);

    // Opening a related metric pushed a history entry.
    await page.goBack();
    await explorer.expectDetailOpen(DETAIL_METRIC);
    await expect.poll(() => explorer.getQueryParam('tab'), { timeout: 15000 }).toBe('related');
  });
});
