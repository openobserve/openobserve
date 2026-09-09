// tracesStreamingPagination.spec.js
// Tests for OpenObserve Traces streaming pagination (Issue #14317).
// Verifies the per-request `hasWritten` page-write fix: a page change REPLACES the
// previous page (even when the backend opens the page with an empty batch), rows-per-page
// changes reset to page 1, and pagination visibility is gated on the count query.
// Ingests its own trace batch in beforeAll because global-setup seeds only 20 traces,
// which is below the default 25 rows-per-page threshold needed for a second page.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

test.describe("Traces Streaming Pagination testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Seed > 25 traces into the `default` stream ONCE so a second page exists. The
  // global setup ingests only 20 traces (below the 25 rows-per-page threshold), so
  // the pagination bar would never render a page 2 without this top-up. Each worker
  // runs beforeAll once; trace_ids are unique per generateTrace(), so batches from
  // parallel workers never collide.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const result = await ingestTraces(page, 60);
      testLogger.info('Seeded traces for streaming pagination', {
        successful: result.successful,
        failed: result.failed,
      });
    } catch (e) {
      // Non-fatal: the data-guarded tests below skip when the stream lacks a second page.
      testLogger.warn('Trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.tracesPage.navigateToTraces();
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 - Critical Path

  test("P0: Pagination controls become visible after a trace search", {
    tag: ['@traces-streaming-pagination', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing pagination visibility after a search');

    await pm.tracesPage.setupTraceSearch();

    // Count query resolves asynchronously; poll for a positive total.
    await expect.poll(
      () => pm.tracesPage.getTotalTraceCount(),
      { timeout: 20000, intervals: [500, 1000, 1500, 2000] }
    ).toBeGreaterThan(0);

    await pm.tracesPage.waitForPaginationVisible();
    expect(await pm.tracesPage.isPaginationVisible()).toBe(true);

    testLogger.info('Pagination controls visible after a trace search');
  });

  test("P0: Clicking page 2 replaces page-1 rows without leaving stale rows", {
    tag: ['@traces-streaming-pagination', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing page-2 replace semantics (hasWritten fix)');

    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForPaginationVisible();

    const total = await pm.tracesPage.getTotalTraceCount();
    test.skip(total <= 25, `need >25 traces for a second page, got ${total}`);

    const page1Ids = await pm.tracesPage.getVisibleRowIdentifiers();
    expect(page1Ids.length).toBeGreaterThan(0);

    await pm.tracesPage.clickPage(2);

    // The headline assertion: page-2 becomes active AND the grid swaps to page-2
    // rows — no page-1 row identifier may remain visible (replace, not append).
    await expect.poll(async () => {
      const active = await pm.tracesPage.isPageActive(2);
      const ids = await pm.tracesPage.getVisibleRowIdentifiers();
      return active && ids.length > 0 && !ids.some((id) => page1Ids.includes(id));
    }, { timeout: 20000, intervals: [500, 1000, 1500, 2000] }).toBe(true);

    testLogger.info('Page-2 click replaced page-1 rows with no stale rows');
  });

  // P1 - Important variations

  test("P1: Next and Prev buttons navigate pages and swap content", {
    tag: ['@traces-streaming-pagination', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing prev/next navigation');

    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForPaginationVisible();

    const total = await pm.tracesPage.getTotalTraceCount();
    test.skip(total <= 25, `need >25 traces for a second page, got ${total}`);

    const page1Ids = await pm.tracesPage.getVisibleRowIdentifiers();
    expect(page1Ids.length).toBeGreaterThan(0);
    expect(await pm.tracesPage.isPrevDisabled()).toBe(true);

    await pm.tracesPage.clickNextPage();
    await expect.poll(async () => {
      const active = await pm.tracesPage.isPageActive(2);
      const ids = await pm.tracesPage.getVisibleRowIdentifiers();
      return active && ids.length > 0 && !ids.some((id) => page1Ids.includes(id));
    }, { timeout: 20000, intervals: [500, 1000, 1500, 2000] }).toBe(true);

    await pm.tracesPage.clickPrevPage();
    await expect.poll(async () => {
      const active = await pm.tracesPage.isPageActive(1);
      const ids = await pm.tracesPage.getVisibleRowIdentifiers();
      return active && ids.some((id) => page1Ids.includes(id));
    }, { timeout: 20000, intervals: [500, 1000, 1500, 2000] }).toBe(true);

    testLogger.info('Prev/next navigation swaps content correctly');
  });

  test("P1: Changing rows-per-page re-queries and resets to page 1", {
    tag: ['@traces-streaming-pagination', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing rows-per-page reset');

    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForPaginationVisible();

    // A second page must exist at the DEFAULT rows-per-page (25) for the reset to
    // be observable: the title promises a transition (page 2 → back to page 1),
    // which only has meaning if the test leaves page 1 first.
    const total = await pm.tracesPage.getTotalTraceCount();
    test.skip(total <= 25, `need >25 traces for a second page at default size, got ${total}`);

    // Leave page 1 and confirm the transition target is reachable before changing
    // rows-per-page, so the reset assertion below cannot pass by never moving.
    await pm.tracesPage.clickPage(2);
    await expect.poll(
      () => pm.tracesPage.isPageActive(2),
      { timeout: 20000, intervals: [500, 1000, 1500, 2000] }
    ).toBe(true);

    await pm.tracesPage.changeRowsPerPage(10);

    // currentPage resets to 0 → page-1 button active AND page-2 button inactive.
    // Poll both (the re-query is async) so a regression that drops the reset flips
    // this to page-2-active and fails.
    await expect.poll(async () => {
      const page1Active = await pm.tracesPage.isPageActive(1);
      const page2Active = await pm.tracesPage.isPageActive(2);
      return page1Active && !page2Active;
    }, { timeout: 20000, intervals: [500, 1000, 1500, 2000] }).toBe(true);

    const rowsPerPage = await pm.tracesPage.getRowsPerPageValue();
    expect(rowsPerPage).toBe('10');

    // Re-queried with size=10 → at most 10 rows render (and at least one).
    const visibleCount = await pm.tracesPage.getTraceCount();
    expect(visibleCount).toBeGreaterThan(0);
    expect(visibleCount).toBeLessThanOrEqual(10);

    testLogger.info('Rows-per-page change re-queried and reset to page 1');
  });

  // P2 - Edge cases

  test("P2: Single page shows pagination with prev/next disabled", {
    tag: ['@traces-streaming-pagination', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing single-page pagination state');

    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForPaginationVisible();

    const total = await pm.tracesPage.getTotalTraceCount();
    test.skip(total === 0, 'no results — covered by zero-results test');
    test.skip(total > 25, `need 0 < total <= 25 for a single page, got ${total}`);

    expect(await pm.tracesPage.isPaginationVisible()).toBe(true);
    expect(await pm.tracesPage.isPrevDisabled()).toBe(true);
    expect(await pm.tracesPage.isNextDisabled()).toBe(true);

    testLogger.info('Single-page pagination shows prev/next disabled');
  });

  test("P2: Zero results hide pagination and show the no-results state", {
    tag: ['@traces-streaming-pagination', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing zero-results pagination state');

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.enterTraceQuery("service_name='nonexistent-service-zz-12345'");
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();

    // No results → count stays 0 → showPagination stays false.
    await expect.poll(
      () => pm.tracesPage.isNoResultsVisible(),
      { timeout: 20000, intervals: [500, 1000, 1500, 2000] }
    ).toBe(true);
    expect(await pm.tracesPage.isPaginationVisible()).toBe(false);

    testLogger.info('Zero results hide pagination and show the no-results state');
  });
});
