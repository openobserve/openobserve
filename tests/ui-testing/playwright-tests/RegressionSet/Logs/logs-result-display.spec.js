const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData, sendRequest, getHeaders, getIngestionUrl } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const logData = require('../../../fixtures/log.json');

const STREAM = 'e2e_automate';
const PAGE_SIZE = 100;
const DENSE_ROWS = 12;

test.describe("Logs Result Display Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped: ${error.message}`);
    }
    await pm.logsPage.selectStream(STREAM);
  });

  test("match_all matches render highlighted @bug-9542 @P0 @regression @logsRegression", async () => {
    await pm.logsPage.enableSqlModeIfNeeded();
    await pm.logsPage.setQueryEditorContent(
      `SELECT * FROM "${STREAM}" WHERE match_all('ingester')`,
    );
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();

    // The defect was matches rendering plain, so the highlight markup is the contract.
    await pm.logsPage.expectHighlightedMatchesRendered();
    const highlights = await pm.logsPage.getHighlightedMatchCount();
    testLogger.info(`Highlighted match nodes: ${highlights}`);
    expect(highlights, 'match_all results must carry highlight markup').toBeGreaterThan(0);
  });

  test("first page renders a full page of results @bug-10643 @P1 @regression @logsRegression", async () => {
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();

    await pm.logsPage.selectRecordsPerPage(PAGE_SIZE);

    const title = await pm.logsPage.getResultTitleText();
    const rendered = await pm.logsPage.getLogRowCount();
    testLogger.info(`Banner: ${title.replace(/\n/g, ' | ')} | rendered rows: ${rendered}`);

    // The defect was page 1 rendering fewer rows than the banner claimed (47 of 100).
    expect(title, 'banner must claim a full first page').toContain(`1 to ${PAGE_SIZE}`);
    expect(rendered, 'rendered rows must match the page size the banner claims')
      .toBe(PAGE_SIZE);
  });

  test("the event total matches the range, not the histogram bucket @bug-13896 @P1 @regression @logsRegression", async ({ page }) => {
    // The counter was summed from histogram buckets, so it only diverges when the
    // selected range is NARROWER than the histogram interval -- hence one dense
    // second of its own stream rather than the shared fixture.
    const denseStream = 'e2e_13896_' + Math.random().toString(36).slice(2, 7);
    const orgId = getOrgIdentifier() || 'default';
    const secondStartMs = Date.now() - 5 * 60 * 1000;

    const rows = Array.from({ length: DENSE_ROWS }, (_, i) => ({
      _timestamp: (secondStartMs + i * 20) * 1000,
      level: 'info',
      job: 'test_13896',
      log: `dense row ${i}`,
    }));
    await sendRequest(page, getIngestionUrl(orgId, denseStream), rows, getHeaders());

    await pm.logsPage.waitForStreamAvailable(denseStream);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${orgId}&stream=${denseStream}&stream_type=logs` +
      `&from=${secondStartMs}&to=${secondStartMs + 1000}`,
    );
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();

    const title = await pm.logsPage.getResultTitleText();
    const rendered = await pm.logsPage.getLogRowCount();
    testLogger.info(`Banner: ${title.replace(/\n/g, ' | ')} | rendered rows: ${rendered}`);

    const claimedTotal = Number((title.match(/out of\s+([\d.]+)/) || [])[1]);
    expect(Number.isFinite(claimedTotal), `could not read a total from: ${title}`).toBeTruthy();

    // The defect overstated the total by an order of magnitude, counting the whole
    // histogram bucket while the log query correctly filtered to the range.
    expect(claimedTotal, 'the banner total must not exceed the rows in the range')
      .toBeLessThanOrEqual(DENSE_ROWS);
    expect(rendered, 'all rows in the one-second window must render').toBe(claimedTotal);
  });
});
