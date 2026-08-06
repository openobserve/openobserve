/**
 * Performance Dashboard — API Tab — Black Space on Month Change Under Relative Time
 *
 * Regression guard: validates that the Performance Dashboard API tab renders its three
 * resource panels and does NOT exhibit a permanently stuck black/empty space after a
 * time-range change.
 *
 * Bug context: ApiDashboard.vue's `isLoading` ref is never populated (dead code), so the
 * content wrapper's `invisible` CSS class is never applied during panel transitions.
 * Panels clear old data but haven't yet loaded new data → "black space" visible.
 * See ApiDashboard.vue:131 `isLoading = ref([])` (never pushed to).
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const FEATURE_TAG = '@perf-dashboard-api-tab-black-space-relative-time';

test.describe('Performance Dashboard — API Tab — regression', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // ======================================================================
  //  P0 — Critical path
  // ======================================================================

  test('TC01: API tab renders dashboard panels after schema resolution', {
    tag: [FEATURE_TAG, '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('TC01: Navigating directly to the API tab');

    // 1. Navigate directly to the API tab URL with a relative time period.
    await pm.rumPerformancePage.gotoApiTab('15m');

    // 2. Wait for the schema-loading spinner to resolve.
    testLogger.info('TC01: Waiting for _rumdata schema to resolve');
    await pm.rumPerformancePage.waitForSchemaResolved();

    // 3. Assert the API dashboard container is visible.
    await pm.rumPerformancePage.expectApiDashboardVisible();

    // 4. Assert the empty state is NOT shown (stream has resource fields).
    await pm.rumPerformancePage.expectNoEmptyState();

    // 5. Assert at least one grid-stack panel is present and visible —
    //    confirms RenderDashboardCharts mounted and rendered panels.
    testLogger.info('TC01: Asserting dashboard panels are visible');
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    testLogger.info('TC01: Completed — API tab renders dashboard panels');
  });

  test('TC02: Panels render content after relative time range change (no stuck black space)', {
    tag: [FEATURE_TAG, '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('TC02: Setting up — navigate to API tab and wait for panels');

    // 1. Start from the API tab loaded with panels visible (same flow as TC01).
    await pm.rumPerformancePage.gotoApiTab('15m');
    await pm.rumPerformancePage.waitForSchemaResolved();
    await pm.rumPerformancePage.expectApiDashboardVisible();
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    testLogger.info('TC02: Opening date-time picker and changing relative time range');

    // 2. Open the date-time picker.
    await pm.rumPerformancePage.openPerformanceTimePicker();

    // 3. Select a different relative time preset — "Last 1 hour".
    //    This changes the range from the initial "Last 15 minutes" to a longer period.
    await pm.rumPerformancePage.selectRelativeTimePreset('1-h');

    // 4. Click Apply to commit the new time range.
    await pm.rumPerformancePage.applyTimeRange();

    // 5. Guard: verify the URL reflects the new time range before asserting content.
    //    Without this, a silently-failed click could produce a false positive.
    await expect(page).toHaveURL(/period=1-h/);

    testLogger.info('TC02: Waiting for panels to re-render after time change');

    // 6. Wait for panels to re-render with content. This polls until at least one
    //    grid-stack panel contains visible child content — the core regression guard.
    await pm.rumPerformancePage.expectDashboardContentAfterTimeChange();

    // 7. Confirm the API dashboard container still has visible content.
    await pm.rumPerformancePage.expectApiDashboardVisible();

    testLogger.info('TC02: Completed — panels re-rendered without stuck black space');
  });

  // ======================================================================
  //  P1 — Important variations
  // ======================================================================

  test('TC03: Tab switch roundtrip (API → Overview → API) preserves rendered content', {
    tag: [FEATURE_TAG, '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('TC03: Setting up — navigate to API tab and wait for panels');

    // 1. Start from the API tab loaded with panels visible.
    await pm.rumPerformancePage.gotoApiTab('15m');
    await pm.rumPerformancePage.waitForSchemaResolved();
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    testLogger.info('TC03: Switching to Overview tab');

    // 2. Click the Overview tab.
    await pm.rumPerformancePage.clickOverviewTab();

    // 3. Wait for the Overview tab to fully render — refresh button is the signal.
    await pm.rumPerformancePage.clickRefresh();
    await pm.rumPerformancePage.expectSummaryLoadingResolved();

    testLogger.info('TC03: Switching back to API tab');

    // 4. Click the API tab again.
    await pm.rumPerformancePage.clickApiTab();

    // 5. Assert the dashboard is visible and panels are present.
    await pm.rumPerformancePage.expectApiDashboardVisible();
    await pm.rumPerformancePage.expectNoEmptyState();
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    testLogger.info('TC03: Completed — tab roundtrip preserves dashboard content');
  });

  // ======================================================================
  //  P1 — Known gaps (feature-incomplete — recorded as fixme)
  // ======================================================================

  test.fixme('TC04: isLoading is never populated — content wrapper never receives invisible class — not wired: ApiDashboard.vue:131', {
    tag: [FEATURE_TAG, '@all', '@fixme'],
  }, async ({ page }) => {
    // UNWIRED (feature-incomplete)
    // Evidence: ApiDashboard.vue:131 initializes `isLoading` as `ref([])` but no code path
    // ever pushes to it. The `:class="isLoading.length ? 'invisible' : 'visible'"` on :53
    // always evaluates to 'visible'. This is the root cause of the "black space" bug.

    testLogger.info('TC04: This test is a known gap — isLoading is unwired');

    // Navigate to the API tab and get panels loaded.
    await pm.rumPerformancePage.gotoApiTab('15m');
    await pm.rumPerformancePage.waitForSchemaResolved();
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    // Initiate a time-range change that should toggle isLoading.
    await pm.rumPerformancePage.openPerformanceTimePicker();
    await pm.rumPerformancePage.selectRelativeTimePreset('1-h');
    await pm.rumPerformancePage.applyTimeRange();

    // BUG: During the re-query, the content wrapper should receive class 'invisible'
    // but it never does because isLoading.length is always 0.
    // Assertion: the content wrapper currently stays 'visible' (bug — should toggle).
    await pm.rumPerformancePage.expectContentWrapperVisible();
    // When fixed, the wrapper should toggle between invisible/visible during loading.
  });

  test.fixme('TC05: isLoading is never populated — loading overlay never shown — not wired: ApiDashboard.vue:68-76', {
    tag: [FEATURE_TAG, '@all', '@fixme'],
  }, async ({ page }) => {
    // UNWIRED (feature-incomplete)
    // Evidence: ApiDashboard.vue:68-76 `v-show="isLoading.length"` gates the absolute-
    // positioned loading overlay. Same unwired `isLoading` ref as TC04.

    testLogger.info('TC05: This test is a known gap — loading overlay is unwired');

    // Navigate to the API tab and get panels loaded.
    await pm.rumPerformancePage.gotoApiTab('15m');
    await pm.rumPerformancePage.waitForSchemaResolved();
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    // Initiate a time-range change.
    await pm.rumPerformancePage.openPerformanceTimePicker();
    await pm.rumPerformancePage.selectRelativeTimePreset('1-h');
    await pm.rumPerformancePage.applyTimeRange();

    // BUG: The loading overlay (v-show="isLoading.length") should appear during the
    // re-query but never does because isLoading.length is always 0.
    // When fixed, the overlay should be visible during the transition then disappear.
    await pm.rumPerformancePage.expectLoadingOverlayNotVisible();
  });

  // ======================================================================
  //  P2 — Edge cases / nice-to-have
  // ======================================================================

  test('TC06: Manual refresh button on API tab preserves panel visibility', {
    tag: [FEATURE_TAG, '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('TC06: Setting up — navigate to API tab and wait for panels');

    // 1. Start from the API tab loaded with panels visible.
    await pm.rumPerformancePage.gotoApiTab('15m');
    await pm.rumPerformancePage.waitForSchemaResolved();
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    testLogger.info('TC06: Clicking manual refresh button');

    // 2. Click the global Performance refresh button.
    await pm.rumPerformancePage.clickRefresh();

    // 3. Assert that grid-stack panels are still present and visible after refresh.
    await pm.rumPerformancePage.expectDashboardPanelsVisible();

    testLogger.info('TC06: Completed — manual refresh preserves panel visibility');
  });
});
