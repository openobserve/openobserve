const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';

test.describe("Logs streaming histogram ordering", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));

    // Must be registered before the logs page loads, or the app's fetch is already bound.
    await pm.logsPage.captureSearchRequestTimeline();

    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    // A multi-day window splits the search into several partitions; one partition cannot express the bug.
    await pm.logsPage.clickPast6DaysButton();
    await pm.logsPage.ensureHistogramState(true);
    testLogger.info('Streaming histogram ordering setup completed');
  });

  test("the histogram must not start until every data partition has finished", {
    tag: ['@bug-7689', '@P1', '@regression', '@logsRegression', '@logsRegressionStreaming']
  }, async () => {
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectResultsGridSettledWithRows();

    await expect
      .poll(async () => {
        const calls = await pm.logsPage.getSearchRequestTimeline();
        return calls.filter((c) => c.isHistogram && c.end > 0).length;
      }, { timeout: 60000 })
      .toBeGreaterThan(0);

    const calls = await pm.logsPage.getSearchRequestTimeline();
    const dataCalls = calls.filter((c) => !c.isHistogram && c.end > 0);
    const histogramCalls = calls.filter((c) => c.isHistogram);
    testLogger.info(`Data calls: ${dataCalls.length}, histogram calls: ${histogramCalls.length}`);

    expect(dataCalls.length,
      'Precondition: a multi-day window must split the search into more than one data partition'
    ).toBeGreaterThan(1);

    const lastDataEnd = Math.max(...dataCalls.map((c) => c.end));
    const firstHistogramStart = Math.min(...histogramCalls.map((c) => c.start));
    testLogger.info(`Last data response at ${lastDataEnd}ms, first histogram request at ${firstHistogramStart}ms`);

    expect(firstHistogramStart,
      'Bug #7689: the histogram fired while data partitions were still in flight'
    ).toBeGreaterThanOrEqual(lastDataEnd);

    testLogger.info('PASSED: histogram trails the data partitions (Bug #7689)');
  });
});
