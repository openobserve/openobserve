const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData, sendRequest, getHeaders, getIngestionUrl } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');
const logData = require('../../../fixtures/log.json');

const STREAM = 'e2e_automate';
const PAGE_SIZE = 100;
const DENSE_ROWS = 12;
const DECOY_ROWS = 4;
const WIDE_BUCKET_MS = 10_000;

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
    // The picker re-reads millisecond from/to at whole-second precision, so rows at or past the next second would fall outside.
    const bucketStartMs = Math.floor((Date.now() - 5 * 60 * 1000) / WIDE_BUCKET_MS) * WIDE_BUCKET_MS;
    const secondStartMs = bucketStartMs + WIDE_BUCKET_MS / 2;

    // The defect counted rows between the bucket start and the range start, so without decoys there it cannot show.
    const offsetsMs = [
      ...Array.from({ length: DENSE_ROWS }, (_, i) => WIDE_BUCKET_MS / 2 + i * 20),
      ...Array.from({ length: DECOY_ROWS }, (_, i) => 500 + i * 1000),
    ];
    const rows = offsetsMs.map((offset, i) => ({
      _timestamp: (bucketStartMs + offset) * 1000,
      level: 'info',
      job: 'test_13896',
      log: `row ${i}`,
    }));
    await sendRequest(page, getIngestionUrl(orgId, denseStream), rows, getHeaders());

    await pm.logsPage.waitForStreamAvailable(denseStream);

    // Ingest acks before every row is searchable. Settling over the API before the
    // page loads means the banner is read once the window is complete, rather than
    // re-running the query in the UI and hoping the index catches up first.
    await pm.logsPage.waitForSearchableRowCount(
      denseStream,
      DENSE_ROWS + DECOY_ROWS,
      bucketStartMs * 1000,
      (secondStartMs + 1000) * 1000,
    );

    await pm.logsPage.captureHistogramFrames();
    await page.goto(
      `${logData.logsUrl}?org_identifier=${orgId}&stream=${denseStream}&stream_type=logs` +
      `&from=${secondStartMs}&to=${secondStartMs + 1000}`,
    );
    // The banner can read the search total before the histogram replaces it, so the bucket sum is checked on its own.
    const bucketSum = await pm.logsPage.runQueryAndSumHistogram();
    expect(bucketSum, 'the histogram must count only the rows in the range').toBe(DENSE_ROWS);
    await pm.logsPage.expectResultsGridSettledWithRows();

    const title = await pm.logsPage.waitForResultTotal(DENSE_ROWS);
    const rendered = await pm.logsPage.getLogRowCount();
    testLogger.info(`Banner: ${title.replace(/\n/g, ' | ')} | rendered rows: ${rendered}`);

    const claimedTotal = Number((title.match(/out of\s+([\d.]+)/) || [])[1]);
    expect(Number.isFinite(claimedTotal), `could not read a total from: ${title}`).toBeTruthy();

    // The defect overstated the total by an order of magnitude, counting the whole
    // histogram bucket while the log query correctly filtered to the range.
    // Asserted as EQUAL, not <=: a `<=` here also passes when the window is wrong
    // and only part of the seeded second is matched, which is a weaker test than
    // it looks. from/to are milliseconds (see logsUtils), while ingest takes
    // microseconds -- both denote the same instant.
    expect(claimedTotal, 'the banner total must equal the rows seeded in the range')
      .toBe(DENSE_ROWS);
    expect(rendered, 'all rows in the one-second window must render').toBe(claimedTotal);
  });
});
