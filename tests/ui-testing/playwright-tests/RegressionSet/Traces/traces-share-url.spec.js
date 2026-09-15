/**
 * Shared Traces URL applies its parameters on arrival — #11392.
 *
 * This is the second attempt. The first asserted on the ADDRESS BAR and was
 * withdrawn: on a locally-built server the traces URL comes back with
 * `query=` EMPTY even with a filter applied and the index list showing it
 * (four CI attempts, all empty), while o2latestmain writes the base64 query.
 * So the address bar is not a portable place to assert shared state.
 *
 * It goes through the short link instead, the same route #7332 uses for Logs
 * and the one the issue's own closing verification cites (`/web/short/…`).
 * State is held server-side against that link, so the assertion is on the
 * RESTORED APP STATE after following it — never on the URL's query string.
 *
 * Consequence: this needs a deployment with `web_url` set, because ShareButton
 * is disabled without it. The regression workflow sets `ZO_WEB_URL`, so it runs
 * in CI and cannot run against a dev env that leaves `web_url` empty.
 *
 * Nothing here presses Refresh after following the link — "the data loaded" is
 * only meaningful if the arrival did it unprompted, which is the whole bug.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTraces } = require('../../utils/trace-ingestion.js');

const TRACE_STREAM = 'default';

test.describe("Traces shared URL", () => {
  // 6 min: the gate is trace ingest->searchable latency before the error badge
  // can render, which is environmental and runs ~2 min on a loaded shared env.
  test.describe.configure({ mode: 'serial', timeout: 360_000 });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // forceScenario so the error badge is guaranteed: it renders only when
    // errorCount > 0, and a random scenario mix can legitimately produce none.
    await ingestTraces(page, 6, { forceScenario: 'error' });
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Traces share URL setup completed');
  });

  // ==========================================================================
  // Bug #11392: share URL does not work as expected in traces explore
  // https://github.com/openobserve/openobserve/issues/11392
  // ==========================================================================
  test("a shared Traces link should restore its filter and load data on arrival", {
    tag: ['@bug-11392', '@P1', '@regression', '@tracesRegression', '@tracesRegressionShareUrl']
  }, async ({ page, context }) => {
    testLogger.info('Test: shared traces link auto-applies (Bug #11392)');

    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.selectTraceStream(TRACE_STREAM);

    // Applied through the error-only toggle rather than typed, so the shared
    // state is built the way a user would actually produce it.
    const badgeAppeared = await pm.tracesPage.waitForErrorBadgeAfterSearch();
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
