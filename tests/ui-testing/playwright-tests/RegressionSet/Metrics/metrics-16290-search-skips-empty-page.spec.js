const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { postRows, waitForInstantQuery } = require('../../utils/metrics-explore-seed.js');

// Eight is the explorer's first page; the empty ones sort first (A-Z), so page one holds no metric with data.
const RUN = `e2e_16290_${Math.random().toString(36).slice(2, 7)}`;
const EMPTY = Array.from({ length: 8 }, (_, i) => `${RUN}_a${i}`);
const WITH_DATA = `${RUN}_z_live`;

// `_timestamp` is milliseconds on the metrics endpoint.
const gaugeRows = (metric, minutesAgo, points, stepSeconds) => {
  const start = Date.now() - minutesAgo * 60_000;
  return Array.from({ length: points }, (_, i) => ({
    __name__: metric,
    __type__: 'gauge',
    job: 'e2e-16290',
    _timestamp: start + i * stepSeconds * 1000,
    value: i + 1,
  }));
};

// openobserve#16290: with "With data" on, a first page of only no-data cards said "No metrics match" though matches with data remained.
test.describe('Metrics Explorer search past an empty first page (#16290)', () => {
  test.beforeAll(async ({ request }) => {
    // Outside the default "Past 15 Minutes" window and inside the 5 h ingest limit, so these cards settle as no-data.
    await postRows(request, EMPTY.flatMap((metric) => gaugeRows(metric, 40, 10, 30)));
    await postRows(request, gaugeRows(WITH_DATA, 10, 40, 15));
    await waitForInstantQuery(request, WITH_DATA);
  });

  test('a search whose first page is all no-data still shows the match with data', {
    tag: ['@bug-16290', '@P2', '@regression', '@metrics', '@metricsRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);

    await pm.metricsExplorerPage.gotoExplorer({ search: RUN });
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.expectCardCharted(WITH_DATA);
    await expect(page.locator(pm.metricsExplorerPage.noMatchState)).toHaveCount(0);
    for (const metric of EMPTY) {
      await expect(pm.metricsExplorerPage.cardChart(metric), `${metric} has no data in the window`).toHaveCount(0);
    }
  });
});
