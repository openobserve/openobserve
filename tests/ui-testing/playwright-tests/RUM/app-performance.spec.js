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

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
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

  test.fixme('deep-link back-sync is broken: RealUserMonitoring.vue routeNameMapping omits rumPerformanceErrors/rumPerformanceWebVitals/rumPerformanceApis, so /performance/errors redirects to /performance/overview', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing route→tab back-sync');
    await pm.rumPerformancePage.gotoPerformancePath('errors');
    await pm.rumPerformancePage.expectErrorsDashboardMounted();
    await pm.rumPerformancePage.expectActiveTab('errors');
    testLogger.info('Errors tab auto-selected from the deep link');
  });

  test('should re-run the Overview dashboard on manual refresh', {
    tag: ['@rum', '@rum-app-performance-toolbar', '@ui', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Testing manual refresh re-runs the dashboard');
    await pm.rumPerformancePage.gotoPerformance();
    await pm.rumPerformancePage.expectOverviewResolved();
    await pm.rumPerformancePage.clickRefreshAndExpectSearch();
    await pm.rumPerformancePage.expectOverviewResolved();
    testLogger.info('Manual refresh fired a new search and the Overview re-rendered');
  });

  test.fixme('Auto-Run / Live-Mode toggle needs ZO_AUTO_QUERY_ENABLED=true, which no CI shard sets, so useAutoRunToggle never renders the refresh-options dropdown', {
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
      !(await pm.rumPerformancePage.getConfiguredWebUrl()),
      'server has no ZO_WEB_URL, so sharing is disabled by design',
    );
    await pm.rumPerformancePage.expectShareLinkBtnEnabled();
    await pm.rumPerformancePage.clickShareLink();
    await pm.rumPerformancePage.expectLinkCopiedToast();
    const originalUrl = await pm.rumPerformancePage.resolveCopiedShortUrl();
    testLogger.info('Share link resolves to', { originalUrl });
    expect(originalUrl).toContain('/rum/performance');
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
