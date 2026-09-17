const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';
// Odd and small so it cannot coincide with a partition boundary, where the pre-fix truncation over-counted.
const SQL_LIMIT = 7;

test.describe("Logs v0.40.0 regressions", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let seededStream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();
    testLogger.info('Logs v0.40.0 regression setup completed');
  });

  // Without this the seeded stream accumulates in the org on every nightly run.
  test.afterEach(async () => {
    if (seededStream) {
      await pm.logsPage.deleteStream(seededStream).catch((e) =>
        testLogger.warn(`Failed to delete stream ${seededStream}: ${e.message}`)
      );
      seededStream = undefined;
    }
  });

  test("a SQL LIMIT must be exact on the first search, not just on a re-run", {
    tag: ['@bug-10602', '@P0', '@regression', '@logsRegression', '@logsRegressionLimit']
  }, async () => {
    await pm.logsPage.enableSqlModeIfNeeded();
    await pm.logsPage.clearAndFillQueryEditor(`SELECT * FROM "${STREAM}" LIMIT ${SQL_LIMIT}`);
    await pm.logsPage.runQueryAndWaitForResults();

    const firstRunHits = await pm.logsPage.getResultHitsCount();
    testLogger.info(`First run returned ${firstRunHits} hits for LIMIT ${SQL_LIMIT}`);

    expect(firstRunHits,
      `Bug #10602: the first partitioned streaming search returned ${firstRunHits} hits for LIMIT ${SQL_LIMIT}`
    ).toBe(SQL_LIMIT);

    await pm.logsPage.clickRefreshButton();
    const secondRunHits = await pm.logsPage.getResultHitsCount();

    expect(secondRunHits,
      'a re-run must return the same LIMIT-bound count as the first run'
    ).toBe(SQL_LIMIT);

    testLogger.info('PASSED: SQL LIMIT honoured on the first search (Bug #10602)');
  });

  test("the stream list must keep its top rows rendered after a scroll", {
    tag: ['@bug-10602', '@P2', '@regression', '@logsRegression', '@logsRegressionStreamList']
  }, async () => {
    const topLabels = await pm.logsPage.getStreamListTopLabelsAfterScroll();
    testLogger.info(`Top stream labels after scrolling: ${JSON.stringify(topLabels)}`);

    expect(topLabels.length,
      'Precondition: the stream popover must render at least one option'
    ).toBeGreaterThan(0);

    for (const label of topLabels) {
      expect(label,
        'Bug #10602: a recycled virtual row left the top of the stream list blank'
      ).not.toBe('');
    }

    testLogger.info('PASSED: stream list top rows survive a scroll (Bug #10602)');
  });

  test("the stream select must only show its tooltip once more than one stream is picked", {
    tag: ['@bug-10602', '@P2', '@regression', '@logsRegression', '@logsRegressionStreamList']
  }, async ({ page }) => {
    const singleSelection = await pm.logsPage.getStreamSelectTooltipText();
    testLogger.info(`Tooltip with one stream selected: "${singleSelection}"`);

    expect(singleSelection,
      'Bug #10602: a single selected stream needs no tooltip — the trigger already shows its name'
    ).toBe('');

    const [second] = await pm.logsPage.seedLogStreams(`e2e_10602_${Math.random().toString(36).substring(2, 7)}_`, 1);
    seededStream = second;
    await pm.logsPage.waitForStreamAvailable(second, 90000, 3000);

    // The select's options are fetched once at page load, so the stream just seeded is
    // absent from the dropdown until a reload — without this the add silently no-ops.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.addStreamToSelection(second);

    // The control side: without it, a build that never renders the tooltip would pass.
    const multiSelection = await pm.logsPage.getStreamSelectTooltipText();
    testLogger.info(`Tooltip with two streams selected: "${multiSelection}"`);

    expect(multiSelection,
      'a multi-stream selection must spell out the names the trigger truncates'
    ).toContain(second);

    testLogger.info('PASSED: stream tooltip gated on a multi-stream selection (Bug #10602)');
  });
});
