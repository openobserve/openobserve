/**
 * Traces sharing and filter-reset regressions — #11392, #12703.
 *
 * Both bugs are about state that the Traces page derives from its query rather
 * than storing separately, so both assert on the query editor's contents and on
 * results arriving without a second user action — not on CSS classes.
 *
 * #12703: the error-only badge is a pure function of the query
 * (`showErrorOnly = activeIncludeFilterValues["span_status"]?.includes("ERROR")`
 * in plugins/traces/Index.vue), and toggling it writes `span_status = 'ERROR'`
 * into the editor via `applyFilters`. Resetting filters therefore has to clear
 * that filter out of the query; the bug was that it did not, leaving the badge
 * latched on with nothing in the query to justify it.
 *
 * #11392: opening a shared Traces URL has to apply the shared parameters and
 * load data on arrival. Asserting "results are present" is only meaningful if
 * nothing in the test presses Refresh after navigation, so neither test below
 * touches the refresh control once the shared URL is open.
 *
 * Error traces are seeded with `forceScenario: 'error'` rather than the default
 * random draw: the error badge only renders when `errorCount > 0`, and a random
 * scenario mix can legitimately produce none.
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

  // ==========================================================================
  // Bug #11392: share URL does not work as expected in traces explore
  // https://github.com/openobserve/openobserve/issues/11392
  // ==========================================================================
  test("a shared Traces URL should apply its parameters and load data on arrival", {
    tag: ['@bug-11392', '@P1', '@regression', '@tracesRegression', '@tracesRegressionShareUrl']
  }, async ({ page, context }) => {
    testLogger.info('Test: shared traces URL auto-applies (Bug #11392)');

    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.selectTraceStream(TRACE_STREAM);

    // No manual search first: waitForErrorBadgeAfterSearch runs the search
    // itself, so an extra pass here only doubled the slowest step.
    // Applied through the error-only toggle rather than typed, so the URL is
    // built from real app state the way a user would produce it.
    const badgeAppeared = await pm.tracesPage.waitForErrorBadgeAfterSearch();
    expect(badgeAppeared,
      'Precondition: seeded error traces must produce the error-count badge'
    ).toBe(true);
    await pm.tracesPage.toggleErrorOnlyFilter();
    await pm.tracesPage.waitForTraceSearchResults();

    // The page URL already carries the whole shareable state
    // (?stream=&period=&query=<base64>&tab=). ShareButton only shortens this
    // same URL through the short-link API, and it is disabled outright when
    // `web_url` is unset — so the URL is taken from the address bar instead,
    // which keeps the test on the bug (opening a shared link) rather than on
    // the deployment's `ZO_WEB_URL` configuration.
    const sharedUrl = page.url();
    testLogger.info(`Shared URL: ${sharedUrl}`);
    expect(sharedUrl, 'Precondition: the traces URL must carry the shared query')
      .toContain(`query=${encodeURIComponent(Buffer.from("span_status = 'ERROR'").toString('base64'))}`);

    // A fresh page, so nothing from this session's in-memory search state can
    // make the shared URL look like it worked.
    const shared = await context.newPage();
    try {
      await shared.goto(sharedUrl);
      await shared.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      const sharedPm = new PageManager(shared);

      // No refresh click anywhere below — that is the whole bug.
      const restoredQuery = await sharedPm.tracesPage.getQueryEditorContent();
      testLogger.info(`Query restored from shared URL: ${restoredQuery}`);
      expect(restoredQuery,
        'Bug #11392: the shared URL must restore the shared query filter'
      ).toContain('span_status');

      const noStreamSelected = await sharedPm.tracesPage.isNoStreamSelectedVisible();
      expect(noStreamSelected,
        'Bug #11392: the shared URL must restore the stream selection'
      ).toBeFalsy();

      await sharedPm.tracesPage.waitForTraceSearchResults();
      const hasResults = await sharedPm.tracesPage.hasTraceResults();
      expect(hasResults,
        'Bug #11392: a shared URL must load its trace data without a manual refresh'
      ).toBeTruthy();

      testLogger.info('\u2713 PASSED: shared traces URL auto-applied (Bug #11392)');
    } finally {
      await shared.close();
    }
  });
});
