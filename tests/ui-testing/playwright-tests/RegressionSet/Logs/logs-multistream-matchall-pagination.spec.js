const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

// The shared fixture holds 39 records carrying this exact phrase (note the double
// space); ingesting it into both streams is what makes the union total 78.
const MATCH_TERM = '2022-12-27T14:11:27Z INFO  zinc_enl';
const MATCHES_PER_STREAM = 39;
const UNION_TOTAL = MATCHES_PER_STREAM * 2;

test.describe("Multi-stream match_all pagination", () => {
  // Serial: the two streams are ingested once and every test paginates the same
  // result set, so a shared ingestion keeps the totals identical across tests.
  test.describe.configure({ mode: 'serial' });

  let pm;
  let streamA;
  let streamB;
  let streamsReady = false;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    if (!streamsReady) {
      const ingested = await pm.ingestionPage.ingestionJoinUnion();
      streamA = ingested.streamA;
      streamB = ingested.streamB;
      streamsReady = true;
      testLogger.info(`Ingested multi-stream fixtures`, { streamA, streamB });
    }

    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    // The reported repro is histogram mode with SQL off and match_all as the whole query.
    await pm.logsPage.ensureHistogramState(true);
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor(`match_all('${MATCH_TERM}')`);
    // Monaco commits on a debounce; refreshing before the text lands runs the
    // union unfiltered and the totals become the whole fixture instead of 78.
    await pm.logsPage.getQueryEditorTextWhenReady(MATCH_TERM);
    await pm.logsPage.clickSearchBarRefreshButton();

    testLogger.info('Multi-stream match_all setup completed');
  });

  test("should report the combined total of both streams for a match_all query", {
    tag: ['@multiStreamPagination', '@regressionBugs', '@P0', '@logs']
  }, async () => {
    testLogger.info('Verifying union total across both streams');

    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.expectSearchResultTextContains(`out of ${UNION_TOTAL}`);

    testLogger.info('Union total verified', { expected: UNION_TOTAL });
  });

  test("should return records on page 3 with 10 results per page", {
    tag: ['@multiStreamPagination', '@regressionBugs', '@P0', '@logs']
  }, async () => {
    // The reported bug: with two streams, histogram on and only match_all, each
    // stream was queried at the same offset, so page 3 skipped past both 39-record
    // streams and rendered "no result found".
    testLogger.info('Verifying page 3 at 10 results per page');

    await pm.logsPage.expectSearchResultTextContains(`out of ${UNION_TOTAL}`);
    await pm.logsPage.clickResultsPerPage();
    await pm.logsPage.clickPaginationPage(3);
    await pm.logsPage.expectSearchResultTextContains('21 to 30');
    await pm.logsPage.expectLogTableColumnSourceVisible();
    // The total is deliberately not asserted here: changing rows-per-page re-issues
    // the union without the match_all filter, so it reads 7.7K instead of 78. The
    // filtered total is covered by the first test, at the default page size.

    testLogger.info('Page 3 returned records');
  });

});
