const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData, ingestCustomData, waitForStreamData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';
const SQL_LIMIT = 15;
const EXIT_ROWS = 120;

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

  test("Run query after Search Around leaves search-around mode", {
    tag: ['@ent-3603', '@P1', '@regression', '@logsRegression', '@logsRegressionSearchAround']
  }, async ({ page }) => {
    const stream = `e2e_sa_exit_${Date.now()}`;
    const rows = Array.from({ length: EXIT_ROWS }, (_, i) => ({ level: 'info', seq: i, message: `search around exit ${i}` }));
    const ingest = await ingestCustomData(page, stream, rows);
    expect(ingest.status, 'Precondition: rows must ingest').toBe(200);
    try {
      expect(await waitForStreamData(page, stream, EXIT_ROWS, 60000), 'Precondition: all rows searchable').toBe(true);
      // The stream did not exist when beforeEach loaded the page, so reload the stream list by selecting it.
      await pm.logsPage.selectStream(stream);
      await pm.logsPage.enableSqlModeIfNeeded();

      await pm.logsPage.clearAndFillQueryEditor(`SELECT * FROM "${stream}"`);
      await pm.logsPage.runQueryAndWaitForResults();
      await pm.logsPage.expectResultsGridSettledWithRows();

      await pm.logsPage.runSearchAroundFromRow(0);
      await expect
        .poll(async () => (await pm.logsPage.getAroundResponses()).length, { timeout: 30000 })
        .toBeGreaterThan(0);

      await pm.logsPage.expectShareLinkButtonDisabled();

      const histogramRequests = pm.logsPage.trackHistogramRequests();
      await pm.logsPage.runQueryAndWaitForResults();
      await pm.logsPage.expectResultsGridSettledWithRows();

      await expect.poll(() => histogramRequests().length, {
        message: 'ENT#3603: Run query after Search Around must send the histogram request again',
        timeout: 30000,
      }).toBeGreaterThan(0);
      expect(new URL(page.url()).searchParams.get('show_histogram')).toBe('true');
      await pm.logsPage.expectShareLinkButtonEnabled();
      await expect.poll(() => pm.logsPage.getVisibleResultTitleText(), {
        message: `ENT#3603: the count must be the exact ${EXIT_ROWS}, not a "+" lower bound`,
        timeout: 30000,
      }).toContain(`out of ${EXIT_ROWS} events`);
    } finally {
      await pm.streamsPage.deleteStreamViaAPI(stream).catch(() => {});
    }
  });
});
