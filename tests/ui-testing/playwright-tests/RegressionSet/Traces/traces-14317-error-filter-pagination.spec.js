const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestSequencedErrorSpans } = require('../../utils/trace-ingestion.js');

const ERROR_SPANS = 90;
const ERROR_FILTER = "span_status = 'ERROR'";

// Rows are newest-first, and the seeded err-op-000 is the newest, so page N holds a known slice.
const opRange = (from, to) =>
  Array.from({ length: Math.min(to, ERROR_SPANS) - from }, (_, k) => `err-op-${String(from + k).padStart(3, '0')}`);

test.describe("Traces error-filter pagination (#14317)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    const stream = 'e2e_14317_' + Math.random().toString(36).slice(2, 7);
    const ingest = await ingestSequencedErrorSpans(page, stream, ERROR_SPANS);
    expect(ingest.status, 'Precondition: seeded spans must ingest').toBe(200);

    await pm.tracesPage.navigateToTracesUrlWithStream(stream);
    await pm.tracesPage.setTimeRange('1h');
    await pm.tracesPage.switchToSpansMode();
    await pm.tracesPage.enterTraceQuery(ERROR_FILTER);
    await pm.tracesPage.searchUntilResultCount(`${ERROR_SPANS} Spans Found`);
  });

  test("each numbered page shows its own error spans instead of repeating page 1", {
    tag: ['@bug-14317', '@P1', '@regression', '@tracesRegression']
  }, async () => {
    await pm.tracesPage.setResultRecordsPerPage(25);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), { timeout: 20000 }).toEqual(opRange(0, 25));
    expect(await pm.tracesPage.getResultPageCount(), '90 spans at 25 per page is 4 pages').toBe(4);

    for (const [pageNumber, from] of [[2, 25], [3, 50], [4, 75], [1, 0]]) {
      await pm.tracesPage.goToResultPage(pageNumber);
      const expected = opRange(from, from + 25);
      await expect.poll(() => pm.tracesPage.getResultOperationNames(), {
        timeout: 20000,
        message: `Bug #14317: page ${pageNumber} must replace the grid with its own rows, not repeat or append earlier pages`,
      }).toEqual(expected);
      expect(await pm.tracesPage.getResultSpanStatuses(), `page ${pageNumber} must hold only ERROR spans`)
        .toEqual(expected.map(() => 'ERROR'));
    }
    testLogger.info('PASSED: every page of the error-filtered spans is distinct (Bug #14317)');
  });

  test("next and previous buttons move to the neighbouring page of error spans", {
    tag: ['@bug-14317', '@P1', '@regression', '@tracesRegression']
  }, async () => {
    await pm.tracesPage.setResultRecordsPerPage(25);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), { timeout: 20000 }).toEqual(opRange(0, 25));

    for (const [step, from] of [['next', 25], ['next', 50], ['prev', 25]]) {
      if (step === 'next') await pm.tracesPage.clickResultPaginationNext();
      else await pm.tracesPage.clickResultPaginationPrev();
      await expect.poll(() => pm.tracesPage.getResultOperationNames(), {
        timeout: 20000,
        message: `Bug #14317: "${step}" must land on spans ${from}-${from + 24} only`,
      }).toEqual(opRange(from, from + 25));
    }
  });

  test("a larger page size still pages through distinct error spans", {
    tag: ['@bug-14317', '@P2', '@regression', '@tracesRegression']
  }, async () => {
    await pm.tracesPage.setResultRecordsPerPage(50);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), { timeout: 20000 }).toEqual(opRange(0, 50));
    expect(await pm.tracesPage.getResultPageCount(), '90 spans at 50 per page is 2 pages').toBe(2);

    await pm.tracesPage.goToResultPage(2);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), {
      timeout: 20000,
      message: 'Bug #14317: the last partial page must show only its 40 spans',
    }).toEqual(opRange(50, 90));
  });

  test("the traces view pages through distinct error traces under the same filter", {
    tag: ['@bug-14317', '@P2', '@regression', '@tracesRegression']
  }, async () => {
    await pm.tracesPage.switchToSearchView();
    // The traces badge counts with approx_distinct, so it can read a few under the seeded total.
    await pm.tracesPage.searchUntilResultCount('Traces Found');
    await pm.tracesPage.setResultRecordsPerPage(25);
    await expect.poll(() => pm.tracesPage.getResultOperationNames(), { timeout: 20000 }).toEqual(opRange(0, 25));

    for (const [pageNumber, from] of [[2, 25], [4, 75]]) {
      await pm.tracesPage.goToResultPage(pageNumber);
      await expect.poll(() => pm.tracesPage.getResultOperationNames(), {
        timeout: 20000,
        message: `traces page ${pageNumber} must hold only its own error traces`,
      }).toEqual(opRange(from, from + 25));
    }
  });
});
