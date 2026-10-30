// Create alert from Explorer charts: a grid card's right-click, and the detail view header button.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { DETAIL_METRIC, seedDetailMetrics } = require('../utils/metrics-explore-seed.js');

const PREFIX_SEARCH = 'e2e_mef_http_';

test.describe('Metrics Explorer create alert', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ request }) => {
    await seedDetailMetrics(request);
  });

  async function openGrid(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const explorer = new PageManager(page).metricsExplorerPage;
    await explorer.gotoExplorer({ search: PREFIX_SEARCH });
    await explorer.expectCardCharted(DETAIL_METRIC);
    return explorer;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('Grid card: right-click → Alert when above opens the form on the card metric', {
    tag: ['@metrics', '@metrics-explorer', '@alerts', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    const explorer = await openGrid(page, testInfo);

    await explorer.createAlertAboveFromChart(explorer.cardChart(DETAIL_METRIC));

    await explorer.expectAlertFormStream(DETAIL_METRIC);
  });

  test('Detail view: overview right-click and the header button both open the form on the metric', {
    tag: ['@metrics', '@metrics-explorer', '@alerts', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    const explorer = await openGrid(page, testInfo);
    await explorer.openMetricDetails(DETAIL_METRIC);
    await explorer.expectDetailOpen(DETAIL_METRIC);

    const overview = page.locator(explorer.detailOverview).locator(explorer.cardChartCanvas).first();
    await expect(overview).toBeVisible({ timeout: 30000 });
    await explorer.createAlertAboveFromChart(overview);
    await explorer.expectAlertFormStream(DETAIL_METRIC);

    await page.goBack();
    await explorer.expectDetailOpen(DETAIL_METRIC);
    await explorer.createAlertFromDetailHeader();
    await explorer.expectAlertFormStream(DETAIL_METRIC);
  });
});
