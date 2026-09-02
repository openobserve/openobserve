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

  // Paginating re-issues the union without the match_all WHERE clause: the request
  // goes out with UNION ALL BY NAME but no filter, so the total drifts off 78.
  // Unskip once the paginated re-query preserves the filter.
  test.fixme("should return records on the second page of a multi-stream match_all query", {
    tag: ['@multiStreamPagination', '@regressionBugs', '@P0', '@logs']
  }, async () => {
    // The regression: each stream was queried separately with the same offset, so
    // any page past the first skipped both streams entirely and rendered empty.
    testLogger.info('Verifying the second page is populated');

    await pm.logsPage.expectSearchResultTextContains(`out of ${UNION_TOTAL}`);
    await pm.logsPage.clickPaginationPage(2);
    await pm.logsPage.expectSearchResultTextContains(`51 to ${UNION_TOTAL} out of ${UNION_TOTAL}`);
    await pm.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Second page returned records');
  });

});
