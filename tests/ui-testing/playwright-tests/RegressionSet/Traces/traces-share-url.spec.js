const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTraces } = require('../../utils/trace-ingestion.js');

const TRACE_STREAM = 'default';

test.describe("Traces shared URL", () => {
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
    testLogger.info('Traces share URL setup completed');
  });
  test("a shared Traces link should restore its filter and load data on arrival", {
    tag: ['@bug-11392', '@P1', '@regression', '@tracesRegression', '@tracesRegressionShareUrl']
  }, async ({ page, context }) => {
    testLogger.info('Test: shared traces link auto-applies (Bug #11392)');

    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.selectTraceStream(TRACE_STREAM);

    // Toggled rather than typed, so the shared state is built the way a user produces it.
    const badgeAppeared = await pm.tracesPage.waitForErrorBadgeAfterSearch(4);
    expect(badgeAppeared,
      'Precondition: seeded error traces must produce the error-count badge'
    ).toBe(true);
    await pm.tracesPage.toggleErrorOnlyFilter();
    await pm.tracesPage.waitForTraceSearchResults();

    const beforeShare = await pm.tracesPage.getQueryEditorContent();
    expect(beforeShare,
      'Precondition: the state being shared must carry the span_status filter'
    ).toContain('span_status');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sharedUrl = await pm.tracesPage.clickShareLinkAndGetUrl();
    expect(sharedUrl, 'Share must produce a short link').toMatch(/\/short\/|\/traces/);

    // A fresh page, so a restored filter cannot be leftover in-memory state.
    const shared = await context.newPage();
    try {
      await shared.goto(sharedUrl);
      await shared.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      const sharedPm = new PageManager(shared);
      await sharedPm.tracesPage.waitForTraceSearchResults();

      const restoredQuery = await sharedPm.tracesPage.getQueryEditorContent();
      testLogger.info(`Query restored from shared link: ${restoredQuery}`);
      expect(restoredQuery,
        'Bug #11392: following the shared link must restore the shared filter'
      ).toContain('span_status');

      const noStreamSelected = await sharedPm.tracesPage.isNoStreamSelectedVisible();
      expect(noStreamSelected,
        'Bug #11392: following the shared link must restore the stream selection'
      ).toBeFalsy();

      const hasResults = await sharedPm.tracesPage.hasTraceResults();
      expect(hasResults,
        'Bug #11392: a shared link must load its trace data without a manual refresh'
      ).toBeTruthy();

      testLogger.info('✓ PASSED: shared traces link auto-applied (Bug #11392)');
    } finally {
      await shared.close();
    }
  });
});
