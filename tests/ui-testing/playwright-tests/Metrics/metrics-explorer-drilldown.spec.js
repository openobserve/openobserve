const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { DETAIL_METRIC, seedDetailMetrics } = require('../utils/metrics-explore-seed.js');

test.describe('Metrics Explorer logs and traces drilldown', () => {
  test.beforeAll(async ({ request }) => {
    await seedDetailMetrics(request);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('OSS: the drilldown is visible, disabled and locked, with the Enterprise tooltip', {
    tag: ['@metrics', '@metrics-explorer', '@oss', '@P2', '@all'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on an OSS build (detected: ${edition})`);

    const explorer = pm.metricsExplorerPage;
    await explorer.gotoExplorer({ search: 'e2e_mef_http_' });
    await explorer.openMetricDetails(DETAIL_METRIC);
    await explorer.expectDetailOpen(DETAIL_METRIC);
    await explorer.expectDrilldownLocked('Logs and traces drilldown is an Enterprise feature.');
  });
});
