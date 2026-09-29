const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTraces } = require('../../utils/trace-ingestion.js');

const TRACE_STREAM = 'default';

test.describe("Traces filter reset", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // forceScenario: the badge renders only when errorCount > 0, and a random draw can yield none.
    await ingestTraces(page, 6, { forceScenario: 'error' });
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Traces filter-reset setup completed');
  });

  test("resetting filters should clear the error-only span_status filter", {
    tag: ['@bug-12703', '@P2', '@regression', '@tracesRegression', '@tracesRegressionFilters']
  }, async ({ page }) => {
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.selectTraceStream(TRACE_STREAM);

    // Re-searches until the badge appears: the ingest ack lands before the spans are searchable.
    const badgeAppeared = await pm.tracesPage.waitForErrorBadgeAfterSearch(4);
    expect(badgeAppeared,
      'Precondition: seeded error traces must produce the error-count badge'
    ).toBe(true);

    await pm.tracesPage.toggleErrorOnlyFilter();

    // Asserts the query, not the badge: showErrorOnly is derived from span_status in the query.
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

    testLogger.info('PASSED: error-only filter cleared on reset (Bug #12703)');
  });
});
