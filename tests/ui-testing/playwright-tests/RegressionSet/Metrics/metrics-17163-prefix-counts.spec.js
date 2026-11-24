const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  newRun,
  ingestPrefixCountFixtures,
  waitForPrefixCountFixtures,
  deletePrefixCountFixtures,
} = require('../../utils/metrics-prefix-count-fixtures.js');

test.describe('Metrics Explorer prefix counts testcases', () => {
  test.describe.configure({ mode: 'serial' });

  const run = newRun();

  test.beforeAll(async () => {
    await ingestPrefixCountFixtures(run);
    const ready = await waitForPrefixCountFixtures(run);
    expect(ready, 'fixture streams should be listed and queryable').toBe(true);
  });

  test.afterAll(async () => {
    await deletePrefixCountFixtures(run);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('an unqueried prefix reads N+, then settles to 0 once ticked', {
    tag: ['@bug-17163', '@P3', '@regression', '@metrics', '@metricsRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const explorer = pm.metricsExplorerPage;

    // Searching the run's tag leaves only its 14 metrics: the live ones fill page one with data, so nothing reaches zz.
    await explorer.gotoExplorer({ period: '15m', search: run.TAG });
    await explorer.expectExplorerVisible();
    await explorer.expectWithDataOn();

    const before = await explorer.getPrefixCountText(run.STALE_PREFIX);
    testLogger.info('Stale prefix chip before ticking', { prefix: run.STALE_PREFIX, before });
    expect(before, 'an unqueried prefix must read as a floor, not a definite count').toBe('0+');

    await explorer.tickPrefix(run.STALE_PREFIX);

    await explorer.expectPrefixCount(run.STALE_PREFIX, '0');
    await explorer.expectNoMatchSaysNoData();
  });
});
