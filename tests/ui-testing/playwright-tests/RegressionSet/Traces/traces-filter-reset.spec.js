/**
 * Traces error-only filter reset — #12703.
 *
 * The error-only badge is a pure function of the query
 * (`showErrorOnly = activeIncludeFilterValues["span_status"]?.includes("ERROR")`
 * in plugins/traces/Index.vue), and toggling it writes `span_status = 'ERROR'`
 * into the editor via `applyFilters`. Resetting filters therefore has to clear
 * that filter out of the query; the bug was that it did not, leaving the badge
 * latched on with nothing in the query to justify it. The assertion is on the
 * query editor's contents rather than the badge's CSS classes, because the
 * query is what the state is derived from.
 *
 * Error traces are seeded with `forceScenario: 'error'` rather than the default
 * random draw: the badge only renders when `errorCount > 0`, and a random
 * scenario mix can legitimately produce none.
 *
 * #11392 (shared Traces URL applies its parameters) was attempted here and
 * removed: the address bar carries `query=` EMPTY on the CI build even with a
 * filter applied and the index list showing it, across four retries, while the
 * same flow writes the base64 query locally. Until that difference is
 * explained, any address-bar assertion is environment-dependent. See
 * NEEDS-AUTOMATION-TRIAGE.md.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTraces } = require('../../utils/trace-ingestion.js');

const TRACE_STREAM = 'default';

test.describe("Traces sharing and filter reset", () => {
  // 6 min, above the 5-min CI default: the gate here is trace
  // ingest->searchable latency before the error badge can render, which is
  // environmental and measured at ~2 min on a loaded shared env. Raising it
  // beats letting a slow environment read as a product failure.
  test.describe.configure({ mode: 'serial', timeout: 360_000 });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await ingestTraces(page, 6, { forceScenario: 'error' });
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Traces sharing/filter-reset setup completed');
  });

  // ==========================================================================
  // Bug #12703: Traces error filter not getting reset on resetting query
  // https://github.com/openobserve/openobserve/issues/12703
  // ==========================================================================
  test("resetting filters should clear the error-only span_status filter", {
    tag: ['@bug-12703', '@P2', '@regression', '@tracesRegression', '@tracesRegressionFilters']
  }, async ({ page }) => {
    testLogger.info('Test: error-only filter clears on reset (Bug #12703)');

    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.selectTraceStream(TRACE_STREAM);

    // The badge renders only once a search has returned error spans, and the
    // ingest ack lands before those spans are searchable, so re-search until
    // it appears instead of sleeping.
    const badgeAppeared = await pm.tracesPage.waitForErrorBadgeAfterSearch();
    expect(badgeAppeared,
      'Precondition: seeded error traces must produce the error-count badge'
    ).toBe(true);

    await pm.tracesPage.toggleErrorOnlyFilter();

    const queryWithFilter = await pm.tracesPage.getQueryEditorContent();
    testLogger.info(`Query after enabling error-only: ${queryWithFilter}`);
    expect(queryWithFilter,
      'Precondition: enabling error-only must write span_status into the query'
    ).toContain('span_status');

    await pm.tracesPage.resetAllFilters();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const queryAfterReset = await pm.tracesPage.getQueryEditorContent();
    testLogger.info(`Query after reset: ${queryAfterReset}`);

    expect(queryAfterReset,
      'Bug #12703: reset must clear the error-only span_status filter from the query'
    ).not.toContain('span_status');

    testLogger.info('✓ PASSED: error-only filter cleared on reset (Bug #12703)');
  });

});
