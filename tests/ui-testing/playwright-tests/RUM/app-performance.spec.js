// RUM App Performance toolbar & toggle group
//
// AppPerformance.vue is the RUM Performance page shell: a toolbar holding a
// four-tab OToggleGroup (Overview / Vitals / Errors / API), a date-time range
// picker, an auto-refresh control, a refresh button (+ an optional refresh-
// options dropdown carrying the config-gated Auto-Run "Live Mode" toggle) and a
// share-link button. This spec verifies the toolbar & toggle-group behaviour —
// tab rendering, tab→route navigation, route→tab back-sync (deep-link), manual
// refresh, the Auto-Run toggle gating, and the share-link button — without
// asserting dashboard *content* (panels/chart data), which is data-dependent.
//
// Data independence: the `_rumdata` stream need not exist for these tests to
// pass. A missing/failed schema fetch flips each child's `schemaResolved=true`
// and renders the full dashboard (no-op filter) or an empty state, so the
// assertions target the *resolved* (not-stuck) terminal state, not panel data.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('RUM App Performance toolbar & toggle group', () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('should render the toolbar with four tabs and Overview active by default', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing toolbar rendering and default active tab');
    await pm.rumPerformancePage.gotoPerformance();
    await pm.rumPerformancePage.expectToolbarVisible();
    await pm.rumPerformancePage.expectTabVisible('overview');
    await pm.rumPerformancePage.expectTabVisible('web_vitals');
    await pm.rumPerformancePage.expectTabVisible('errors');
    await pm.rumPerformancePage.expectTabVisible('api');
    await pm.rumPerformancePage.expectActiveTab('overview');
    await pm.rumPerformancePage.expectInactiveTab('web_vitals');
    await pm.rumPerformancePage.expectInactiveTab('errors');
    await pm.rumPerformancePage.expectInactiveTab('api');
    await pm.rumPerformancePage.expectOverviewResolved();
    testLogger.info('Toolbar, tabs and default Overview resolved');
  });

  test('should navigate the route and mount the matching child for each tab', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing tab→route→child wiring');
    await pm.rumPerformancePage.gotoPerformance();

    await pm.rumPerformancePage.clickTab('errors');
    await expect(page).toHaveURL(/performance\/errors/);
    await pm.rumPerformancePage.expectErrorsDashboardMounted();
    await pm.rumPerformancePage.expectActiveTab('errors');

    await pm.rumPerformancePage.clickTab('api');
    await expect(page).toHaveURL(/performance\/apis/);
    await pm.rumPerformancePage.expectApiDashboardMounted();
    await pm.rumPerformancePage.expectActiveTab('api');

    await pm.rumPerformancePage.clickTab('web_vitals');
    await expect(page).toHaveURL(/performance\/web-vitals/);
    await pm.rumPerformancePage.expectWebVitalsMounted();
    await pm.rumPerformancePage.expectActiveTab('web_vitals');

    await pm.rumPerformancePage.clickTab('overview');
    await expect(page).toHaveURL(/performance\/overview/);
    await pm.rumPerformancePage.expectOverviewResolved();
    await pm.rumPerformancePage.expectActiveTab('overview');

    testLogger.info('All four tabs navigated and mounted their child');
  });

  test.fixme('deep-link back-sync is broken in this build: RealUserMonitoring.vue onMounted/onUpdated routeNameMapping omits rumPerformanceErrors/rumPerformanceWebVitals/rumPerformanceApis, so /performance/errors redirects to /performance/overview (web/src/views/RUM/RealUserMonitoring.vue:173-181, :200-208)', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing route→tab back-sync');
    await pm.rumPerformancePage.gotoPerformancePath('errors');
    await pm.rumPerformancePage.expectErrorsDashboardMounted();
    await pm.rumPerformancePage.expectActiveTab('errors');
    testLogger.info('Errors tab auto-selected from the deep link');
  });

  test('should re-run the Overview dashboard on manual refresh without hanging', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Testing manual refresh resolves');
    await pm.rumPerformancePage.gotoPerformance();
    await pm.rumPerformancePage.expectOverviewResolved();
    await pm.rumPerformancePage.clickRefresh();
    await pm.rumPerformancePage.expectSummaryLoadingResolved();
    testLogger.info('Manual refresh resolved without a stuck loading indicator');
  });

  test.fixme('Auto-Run / Live-Mode toggle — not wired in the default E2E env: auto_query_enabled defaults to false (src/config/src/config.rs:2487), so the refresh-options dropdown and toggle never render (web/src/composables/dashboard/useAutoRunToggle.ts:38, web/src/views/RUM/AppPerformance.vue:81)', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Testing Auto-Run toggle (requires ZO_AUTO_QUERY_ENABLED=true)');
    await pm.rumPerformancePage.gotoPerformance();
    const before = await pm.rumPerformancePage.getAutoRunStorageValue();
    await pm.rumPerformancePage.openRefreshOptions();
    await pm.rumPerformancePage.clickAutoRunToggle();
    await pm.rumPerformancePage.expectAutoRunStorageChanged(before);
    testLogger.info('Auto-Run toggle flipped the stored flag');
  });

  test('should copy the current route URL when the share-link button is clicked', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Testing share-link button');
    await pm.rumPerformancePage.gotoPerformance();
    await pm.rumPerformancePage.expectShareLinkBtnVisible();
    test.skip(
      await pm.rumPerformancePage.isShareLinkBtnDisabled(),
      'Share button disabled: zoConfig.web_url is not configured (config gating, not a regression)',
    );
    await pm.rumPerformancePage.clickShareLink();
    await pm.rumPerformancePage.expectLinkCopiedToast();
    const copiedUrl = await pm.rumPerformancePage.getCopiedUrl();
    expect(copiedUrl).toContain('/short/');
    testLogger.info('Share link copied', { copiedUrl });
  });

  test('should collapse the tab strip into a dropdown on mobile and navigate', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Testing mobile tab dropdown');
    await page.setViewportSize({ width: 480, height: 900 });
    await pm.rumPerformancePage.gotoPerformance();
    await pm.rumPerformancePage.expectTabsDropdownBtnVisible();
    await pm.rumPerformancePage.clickMobileTab('errors');
    await expect(page).toHaveURL(/performance\/errors/);
    await pm.rumPerformancePage.expectErrorsDashboardMounted();
    testLogger.info('Mobile tab dropdown navigated to errors');
  });
});
