// "Used in": a dashboard whose panel queries a metric is listed on that metric's detail view, and links to it.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { DETAIL_METRIC, seedDetailMetrics } = require('../utils/metrics-explore-seed.js');
const { panel, createExemplarDashboard, deleteDashboard } = require('../utils/exemplar-fixtures.js');

test.describe('Metrics Explorer "Used in"', () => {
  let dashboardId;
  const title = `e2e_used_in_${Date.now().toString(36)}`;

  test.beforeAll(async ({ request }) => {
    await seedDetailMetrics(request);
    dashboardId = await createExemplarDashboard(title, [
      panel('Panel_used_in', {
        title: 'Request rate',
        queries: [{ query: `sum(rate(${DETAIL_METRIC}[$__rate_interval]))` }],
      }),
    ]);
  });

  test.afterAll(async () => {
    await deleteDashboard(dashboardId);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('lists a dashboard that queries the metric and opens it', {
    tag: ['@metrics', '@metrics-explorer', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const explorer = new PageManager(page).metricsExplorerPage;
    await explorer.gotoExplorer({ search: 'e2e_mef_http_' });
    await explorer.openMetricDetails(DETAIL_METRIC);
    await explorer.expectDetailOpen(DETAIL_METRIC);

    await explorer.selectDetailTab('used_in');
    const link = page.locator(`[data-test="metrics-detail-used-in-link-dashboards-${dashboardId}"]`);
    await expect(link).toHaveText(title, { timeout: 30000 });

    await link.click();
    await expect.poll(() => explorer.getQueryParam('dashboard'), { timeout: 15000 }).toBe(dashboardId);
  });
});
