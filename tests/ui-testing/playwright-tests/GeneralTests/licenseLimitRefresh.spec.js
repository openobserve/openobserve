const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("License Limit Refresh testcases", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('License test setup completed');
  });

  // ===== P0: TC-01 — Happy path: successful refresh =====
  test("should show success notification when Refresh License Limits is clicked",
    { tag: ['@licenseLimitRefresh', '@all', '@P0'] },
    async ({ page }) => {
      testLogger.info('Navigating to License tab');
      await pm.licensePage.navigateToLicenseTab();

      // Guard: verify we are in active-license state before clicking
      const refreshVisible = await pm.licensePage.isRefreshButtonVisible();
      if (!refreshVisible) {
        testLogger.info('No active license in this environment — skipping happy-path test.');
        test.skip();
      }

      testLogger.info('Clicking Refresh License Limits button');
      await pm.licensePage.clickRefreshLicenseLimits();

      testLogger.info('Waiting for success notification');
      await pm.licensePage.expectSuccessNotification('License limit refresh triggered successfully');

      // Assert the page is still in active-license state after refresh
      await pm.licensePage.expectRefreshButtonVisible();

      testLogger.info('TC-01: Refresh success notification test completed');
    });

  // ===== P0: TC-02 — Absence of refresh button when no license =====
  test("should not show Refresh License Limits button when no license is installed",
    { tag: ['@licenseLimitRefresh', '@all', '@P0'] },
    async ({ page }) => {
      testLogger.info('Navigating to License tab');
      await pm.licensePage.navigateToLicenseTab();

      // Check if we are in no-license state
      const isNoLicense = await pm.licensePage.isNoLicenseState();
      if (!isNoLicense) {
        testLogger.info('License is active in this environment — cannot verify no-license state.');
        test.skip();
      }

      // Assert the no-license UI is shown
      await pm.licensePage.expectNoLicenseButtonVisible();

      // Assert the refresh button is NOT rendered
      await pm.licensePage.expectRefreshButtonNotVisible();

      testLogger.info('TC-02: Refresh button absence in no-license state verified');
    });

  // ===== P1: TC-03 — Error handling on API failure =====
  test("should show error notification when Refresh License Limits API fails",
    { tag: ['@licenseLimitRefresh', '@all', '@P1'] },
    async ({ page }) => {
      testLogger.info('Setting up route interception for POST /api/license/refresh → 403');
      await pm.licensePage.interceptRefreshEndpoint(403, {
        message: 'Unauthorized Access to license',
      });

      testLogger.info('Navigating to License tab');
      await pm.licensePage.navigateToLicenseTab();

      // Guard: verify we are in active-license state
      const refreshVisible = await pm.licensePage.isRefreshButtonVisible();
      if (!refreshVisible) {
        testLogger.info('No active license in this environment — skipping error-handling test.');
        test.skip();
      }

      testLogger.info('Clicking Refresh License Limits (intercepted to fail)');
      await pm.licensePage.clickRefreshLicenseLimits();

      testLogger.info('Waiting for error notification');
      await pm.licensePage.expectErrorNotification('Failed to refresh license limits');

      // Assert the page remains in active-license state
      await pm.licensePage.expectRefreshButtonVisible();

      testLogger.info('TC-03: API error notification test completed');
    });

  // ===== P1: TC-04 — Button order verification =====
  test("should render Refresh License Limits as the third button in the active-license row",
    { tag: ['@licenseLimitRefresh', '@all', '@P1'] },
    async ({ page }) => {
      testLogger.info('Navigating to License tab');
      await pm.licensePage.navigateToLicenseTab();

      // Guard: verify we are in active-license state
      const refreshVisible = await pm.licensePage.isRefreshButtonVisible();
      if (!refreshVisible) {
        testLogger.info('No active license in this environment — skipping button-order test.');
        test.skip();
      }

      testLogger.info('Verifying button order');
      const order = await pm.licensePage.getButtonOrder();
      await expect(order.length).toBeGreaterThanOrEqual(3);
      await expect(order[0]).toBe('request-new-license-btn');
      await expect(order[1]).toBe('add-license-key-btn');
      await expect(order[2]).toBe('refresh-license-limits-btn');

      testLogger.info('TC-04: Button order verified successfully');
    });

  // ===== P2: TC-05 — UsageReportBanner threshold =====
  test("should show usage report banner only when elapsed time exceeds 6 hours",
    { tag: ['@usageReportBanner', '@all', '@P2'] },
    async ({ page }) => {
      testLogger.info('Navigating to License tab');
      await pm.licensePage.navigateToLicenseTab();

      // Check if store is accessible for manipulating elapsed time
      const storeCheck = await page.evaluate(() => {
        const app = document.querySelector('#q-app');
        if (!app || !app.__vue_app__) return { accessible: false, reason: 'no Vue app' };
        const vueApp = app.__vue_app__;
        const store = vueApp.config.globalProperties.$store;
        if (!store || !store.state) return { accessible: false, reason: 'no Vuex store' };
        if (!('zoConfig' in store.state)) return { accessible: false, reason: 'no zoConfig' };
        return {
          accessible: true,
          hasLastReport: 'last_usage_report_ts' in store.state.zoConfig,
        };
      });

      if (!storeCheck.accessible) {
        testLogger.info(`Vuex store not accessible (${storeCheck.reason}) — cannot test banner threshold.`);
        test.skip();
      }

      const ONE_HOUR_MS = 60 * 60 * 1000;

      // Set last_usage_report_ts to 5 hours ago → banner should be hidden
      testLogger.info('Setting last_usage_report_ts to 5 hours ago');
      await page.evaluate((oneHourMs) => {
        const app = document.querySelector('#q-app').__vue_app__;
        const store = app.config.globalProperties.$store;
        const tsMicros = (Date.now() - (5 * oneHourMs)) * 1000;
        store.replaceState({
          ...store.state,
          zoConfig: {
            ...store.state.zoConfig,
            last_usage_report_ts: tsMicros,
          },
        });
      }, ONE_HOUR_MS);

      // Wait for Vue reactivity to update the DOM
      await page.waitForTimeout(800);
      await pm.licensePage.expectUsageBannerNotVisible();

      // Set last_usage_report_ts to 7 hours ago → banner should be visible
      testLogger.info('Setting last_usage_report_ts to 7 hours ago');
      await page.evaluate((oneHourMs) => {
        const app = document.querySelector('#q-app').__vue_app__;
        const store = app.config.globalProperties.$store;
        const tsMicros = (Date.now() - (7 * oneHourMs)) * 1000;
        store.replaceState({
          ...store.state,
          zoConfig: {
            ...store.state.zoConfig,
            last_usage_report_ts: tsMicros,
          },
        });
      }, ONE_HOUR_MS);

      // Wait for Vue reactivity to update the DOM
      await page.waitForTimeout(800);
      await pm.licensePage.expectUsageBannerVisible();

      testLogger.info('TC-05: Usage report banner threshold test completed');
    });
});
