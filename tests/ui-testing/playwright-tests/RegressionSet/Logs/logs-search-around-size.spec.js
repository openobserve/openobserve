const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';
const SQL_LIMIT = 15;

test.describe("Logs search-around size", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));

    // Must be registered before the logs page loads, or the app's fetch is already bound.
    await pm.logsPage.captureAroundResponses();

    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();
    await pm.logsPage.enableSqlModeIfNeeded();
    testLogger.info('Search-around size setup completed');
  });

  test("search around must honour its own size when the SQL carries a LIMIT", {
    tag: ['@bug-10270', '@P1', '@regression', '@logsRegression', '@logsRegressionSearchAround']
  }, async () => {
    await pm.logsPage.clearAndFillQueryEditor(`SELECT * FROM "${STREAM}" LIMIT ${SQL_LIMIT}`);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectResultsGridSettledWithRows();

    await pm.logsPage.runSearchAroundFromRow(0);

    await expect
      .poll(async () => (await pm.logsPage.getAroundResponses()).length, { timeout: 30000 })
      .toBeGreaterThan(0);

    const calls = await pm.logsPage.getAroundResponses();
    testLogger.info(`Around calls: ${JSON.stringify(calls)}`);

    for (const call of calls) {
      expect(call.requestedSize,
        'Precondition: the around request must carry a size'
      ).toBeGreaterThan(0);

      expect(call.hits,
        `Bug #10270: around returned ${call.hits} hits for size ${call.requestedSize} — the SQL LIMIT leaked into the around query`
      ).toBeLessThanOrEqual(call.requestedSize);
    }

    testLogger.info('PASSED: search around honoured its size over the SQL LIMIT (Bug #10270)');
  });
});
