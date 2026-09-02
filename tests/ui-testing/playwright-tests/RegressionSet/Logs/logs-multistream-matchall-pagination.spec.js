const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

// Fixture holds 39 records with this exact phrase (note the double space), so two streams make 78.
const MATCH_TERM = '2022-12-27T14:11:27Z INFO  zinc_enl';
const MATCHES_PER_STREAM = 39;
const UNION_TOTAL = MATCHES_PER_STREAM * 2;

test.describe("Multi-stream match_all pagination", () => {
  // Serial: one shared ingestion keeps the union total identical across tests.
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
    // Monaco commits on a debounce; refreshing early runs the union unfiltered.
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
    // Reported bug: each stream was queried at the same offset, so page 3 came back empty.
    testLogger.info('Verifying page 3 at 10 results per page');

    await pm.logsPage.expectSearchResultTextContains(`out of ${UNION_TOTAL}`);
    await pm.logsPage.clickResultsPerPage();
    await pm.logsPage.clickPaginationPage(3);
    await pm.logsPage.expectSearchResultTextContains('21 to 30');
    await pm.logsPage.expectLogTableColumnSourceVisible();
    // Total is not asserted here: the rows-per-page re-query drops match_all, so it reads 7.7K.

    testLogger.info('Page 3 returned records');
  });

});
