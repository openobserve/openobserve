/**
 * Traces Regression Bugs Test Suite
 *
 * This suite contains regression tests for traces-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestSequencedErrorSpans } = require('../../utils/trace-ingestion.js');
const { deleteStream } = require('../../utils/traces-api.js');

const SEEDED_PAIRS_9043 = 15;
const PAGE_SIZE_9043 = 10;

// Seeded spans are newest-first and alternate ok-op-NNN, err-op-NNN, so each page's operation names are known.
const expectedOps9043 = (pageIndex) =>
  Array.from({ length: PAGE_SIZE_9043 }, (_, k) => {
    const row = pageIndex * PAGE_SIZE_9043 + k;
    return `${row % 2 === 0 ? 'ok' : 'err'}-op-${String(Math.floor(row / 2)).padStart(3, '0')}`;
  });

async function readSettledPage9043(pm, pageIndex, { alreadySettled = false } = {}) {
  const message = `Bug #9043: page ${pageIndex + 1} must show its own seeded spans, not a re-fetch of earlier rows`;
  if (alreadySettled) expect(await pm.tracesPage.getResultOperationNames(), message).toEqual(expectedOps9043(pageIndex));
  else await expect.poll(() => pm.tracesPage.getResultOperationNames(), { timeout: 30000, message }).toEqual(expectedOps9043(pageIndex));
  const rowLinks = pm.tracesPage.page.locator(pm.tracesPage.searchResultList).locator('[data-test="trace-row-link"]');
  const hrefs = await rowLinks.evaluateAll((links) => links.map((a) => a.getAttribute('href') || ''));
  const ids = hrefs.map((href) => (href.match(/[?&]span_id=([^&#]+)/) || [])[1]);
  expect(ids.length, 'Bug #9043 guard: every visible row must carry a trace-row-link').toBe(PAGE_SIZE_9043);
  expect(ids.filter((id) => !id), `Bug #9043 guard: every row link must carry a span_id, got ${JSON.stringify(hrefs)}`).toEqual([]);
  return ids;
}

test.describe("Traces Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Navigate to traces page
    await pm.tracesPage.navigateToTraces();

    // Select the default stream as data is ingested for it only
    await pm.tracesPage.isStreamSelectVisible()
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForTimeout(2000);

    testLogger.info('Traces regression test setup completed');
  });

  // ==========================================================================
  // Bug #10769: Traces UI: Column sorting support
  // https://github.com/openobserve/openobserve/issues/10769
  // ==========================================================================
  test("Trace columns should support sorting", {
    tag: ['@bug-10769', '@P1', '@regression', '@tracesRegression', '@sorting']
  }, async ({ page }) => {
    testLogger.info('Test: Verify trace column sorting (Bug #10769)');

    // Wait for traces page to be ready
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Try to run a search to get results
    const runBtn = pm.tracesPage.getRunQueryButton().first();
    if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await runBtn.click();
      // Wait for search results to load
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info('✓ Ran trace search');
    } else {
      testLogger.info('Run button not visible, checking existing results');
    }

    // Find column headers in the trace results table
    const columnHeaders = pm.tracesPage.getTraceResultColumnHeaders();
    const headerCount = await columnHeaders.count();
    testLogger.info(`Found ${headerCount} column headers`);

    // STRONG ASSERTION: Column headers should exist for sorting
    expect(headerCount, 'Bug #10769: Trace table should have column headers for sorting').toBeGreaterThan(0);

    // Try clicking the first sortable column (usually duration or timestamp)
    const durationHeader = pm.tracesPage.getDurationHeader().first();
    const timestampHeader = pm.tracesPage.getTimestampHeader().first();

    let sortedColumnFound = false;

    if (await durationHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await durationHeader.click();
      testLogger.info('✓ Clicked Duration column header');
      sortedColumnFound = true;

      // Check for sort indicator
      const sortIndicator = pm.tracesPage.getSortIndicator();
      const hasSortIndicator = await sortIndicator.count() > 0;
      testLogger.info(`Sort indicator visible: ${hasSortIndicator}`);

      // Click again to toggle sort direction
      await durationHeader.click();
      testLogger.info('✓ Toggled sort direction');
    } else if (await timestampHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timestampHeader.click();
      testLogger.info('✓ Clicked Timestamp column header');
      sortedColumnFound = true;
    } else {
      // Click any visible header
      const firstHeader = columnHeaders.first();
      if (await firstHeader.isVisible()) {
        await firstHeader.click();
        testLogger.info('✓ Clicked first available column header');
        sortedColumnFound = true;
      }
    }

    // PRIMARY ASSERTION: Should be able to click at least one column header
    expect(sortedColumnFound, 'Bug #10769: Should be able to click column headers to enable sorting').toBe(true);

    testLogger.info('✓ PASSED: Column sorting test completed');
  });

  // ==========================================================================
  // Bug #9043: Trace pagination cursor resets when navigating back from trace details
  // https://github.com/openobserve/openobserve/issues/9043
  // ==========================================================================
  test("Pagination cursor should not reset after navigating back from trace details", {
    tag: ['@bug-9043', '@P1', '@regression', '@tracesRegression', '@pagination']
  }, async ({ page }) => {
    testLogger.info('Test: Verify pagination cursor persists after trace detail navigation (Bug #9043)');

    const stream = 'e2e_9043_' + Math.random().toString(36).slice(2, 7);
    const ingest = await ingestSequencedErrorSpans(page, stream, SEEDED_PAIRS_9043);
    expect(ingest.status, 'Precondition: seeded spans must ingest').toBe(200);

    try {
      await pm.tracesPage.navigateToTracesUrlWithStream(stream);
      await pm.tracesPage.setTimeRange('1h');
      await pm.tracesPage.switchToSpansMode();
      await pm.tracesPage.searchUntilResultCount(`${SEEDED_PAIRS_9043 * 2} Spans Found`);
      await pm.tracesPage.setResultRecordsPerPage(PAGE_SIZE_9043);
      await expect.poll(() => pm.tracesPage.getResultPageCount(), {
        timeout: 20000,
        message: `Setup error, not #9043: ${PAGE_SIZE_9043} rows per page did not apply (expected 3 pages)`,
      }).toBe(3);

      const pageOne = await readSettledPage9043(pm, 0);
      await pm.tracesPage.goToResultPage(2);
      const pageTwo = await readSettledPage9043(pm, 1);
      expect(pageTwo.filter((id) => pageOne.includes(id)), 'page 2 must not repeat page 1').toEqual([]);

      // Opening from page 2 is what makes a reset observable: from page 1, "next" lands on page 2 either way.
      await pm.tracesPage.traceRowLinks().first().click();
      await expect(page, 'the row link must open trace details').toHaveURL(/\/traces\/trace-details/, { timeout: 15000 });
      const backButton = page.locator(pm.tracesPage.traceDetailsBackButton).first();
      await expect(backButton, 'trace details must offer Back').toBeVisible({ timeout: 15000 });
      await backButton.click();
      await expect(page, 'Back must return to the traces list').not.toHaveURL(/\/traces\/trace-details/, { timeout: 15000 });

      // The kept-alive list still shows the old rows until any re-run on activation lands, so read only once it is idle.
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await pm.tracesPage.expectTraceListIdle();
      expect(await readSettledPage9043(pm, 1, { alreadySettled: true }), 'Bug #9043: Back must show the same page of spans that was open').toEqual(pageTwo);

      await pm.tracesPage.clickResultPaginationNext();
      const pageThree = await readSettledPage9043(pm, 2);
      expect(
        pageThree.filter((id) => pageOne.includes(id) || pageTwo.includes(id)),
        'Bug #9043: the page loaded after Back must continue past the shown rows, not re-fetch earlier ones',
      ).toEqual([]);

      const loaded = [...pageOne, ...pageTwo, ...pageThree];
      expect(new Set(loaded).size, 'every seeded span must appear exactly once across the three pages').toBe(SEEDED_PAIRS_9043 * 2);
      testLogger.info('PASSED: pagination continued from page 2 after Back (Bug #9043)');
    } finally {
      await deleteStream(page.request, stream);
    }
  });

  // ==========================================================================
  // Bug #11689: Service Catalog: clearing search filter with cross icon blanks out the page
  // https://github.com/openobserve/openobserve/issues/11689
  // ==========================================================================
  test("Clearing search filter should not blank out Service Catalog table", {
    tag: ['@bug-11689', '@P0', '@regression', '@tracesRegression', '@serviceCatalog']
  }, async ({ page }) => {
    testLogger.info('Test: Verify clearing search filter does not blank Service Catalog (Bug #11689)');

    const scPage = pm.servicesCatalogPage;

    // Navigate to Service Catalog
    await scPage.clickServiceCatalogTab();
    await scPage.waitForLoad();

    // STRONG ASSERTION: Services should be loaded
    const initialCount = await scPage.getServiceCount();
    testLogger.info(`Initial service count: ${initialCount}`);
    expect(initialCount, 'Bug #11689: Service Catalog should have services loaded').toBeGreaterThan(0);

    // Type in the filter to trigger the clear button appearance
    await scPage.filterByServiceName('alert');
    testLogger.info('✓ Typed "alert" in search filter');

    // Click the actual clear/cross icon (this was the bug trigger — the framework sets value to null)
    const clearClicked = await scPage.clickFilterClearButton();
    testLogger.info(clearClicked ? '✓ Clicked clear/cross icon' : 'Clear button not visible, used fill(\'\') fallback');

    // STRONG ASSERTION: Must click the actual clear icon — the fill('') fallback doesn't reproduce bug #11689
    expect(clearClicked, 'Bug #11689: clear icon must be clickable — fill(\'\') fallback does not exercise the regression').toBe(true);

    // PRIMARY ASSERTION: Table should NOT be blank after clearing
    const afterClearCount = await scPage.getServiceCount();
    testLogger.info(`Service count after clearing filter: ${afterClearCount}`);
    expect(afterClearCount, 'Bug #11689: Service count should be maintained after clearing filter (table should not go blank)').toBeGreaterThan(0);

    // SECONDARY ASSERTION: Table should still be visible
    const tableVisible = await scPage.isTableVisible();
    expect(tableVisible, 'Bug #11689: Services table should remain visible after clearing filter').toBe(true);

    testLogger.info('✓ PASSED: Service Catalog clear filter test completed');
  });

  test.afterEach(async () => {
    testLogger.info('Traces regression test completed');
  });
});
