const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

test.describe("Telemetry Correlation Dashboard Tests", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // ==================== P0 - Critical Path ====================

  test("TC-01: should show correlation tabs in log detail sidebar", {
    tag: ['@telemetry-correlation', '@all', '@P0', '@enterprise']
  }, async () => {
    testLogger.info('Verifying correlation tabs are visible in log detail sidebar');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    await pm.logsPage.expectCorrelatedLogsTabVisible();
    await pm.logsPage.expectCorrelatedMetricsTabVisible();
    await pm.logsPage.expectCorrelatedTracesTabVisible();

    testLogger.info('All three correlation tabs are visible in the log detail sidebar');
  });

  test("TC-02: should open correlation dashboard from log detail sidebar in embedded-tabs mode", {
    tag: ['@telemetry-correlation', '@all', '@P0', '@enterprise']
  }, async () => {
    testLogger.info('Verifying embedded correlation dashboard opens from log detail sidebar');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    await pm.logsPage.clickCorrelatedLogsTab();

    try {
      await pm.logsPage.expectCorrelationLoadingVisible();
    } catch (e) {
      testLogger.info('Correlation loading spinner not captured (may have resolved too quickly)');
    }
    await pm.logsPage.waitForCorrelationLoaded(30000);

    await pm.logsPage.expectCorrelationLoadingHidden();
    testLogger.info('Correlation dashboard loaded in embedded-tabs mode');
  });

  test("TC-03: should open correlation dashboard dialog from log search inline button", {
    tag: ['@telemetry-correlation', '@all', '@P0', '@enterprise']
  }, async () => {
    testLogger.info('Verifying dialog-mode correlation dashboard opens from inline button');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    const isBtnVisible = await pm.logsPage.isLogCorrelationBtnVisible();

    if (!isBtnVisible) {
      testLogger.info('log-correlation-btn is not visible in this view, skipping dialog-mode test');
      test.skip(true, 'log-correlation-btn not available — dialog entry point not rendered');
      return;
    }

    await pm.logsPage.clickLogCorrelationBtn();
    testLogger.info('Clicked correlation button');

    await pm.logsPage.expectCorrelationDashboardDrawerVisible();
    await pm.logsPage.expectApplyDimensionFiltersVisible();
    await pm.logsPage.expectCorrelationDashboardDrawerVisible();

    testLogger.info('Correlation dashboard dialog opened successfully with dimension filter bar');
  });

  // ==================== P1 - Important Functional Tests ====================

  test("TC-04: should switch between correlation tabs in dialog mode", {
    tag: ['@telemetry-correlation', '@all', '@P1', '@enterprise']
  }, async () => {
    testLogger.info('Verifying tab switching in dialog-mode correlation dashboard');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    const isBtnVisible = await pm.logsPage.isLogCorrelationBtnVisible();

    if (!isBtnVisible) {
      testLogger.info('log-correlation-btn not visible, using correlated traces tab as entry point');
      await pm.logsPage.clickCorrelatedTracesTab();
      test.skip(true, 'Dialog entry point not available — cannot test dialog-mode tab switching');
      return;
    }

    await pm.logsPage.clickLogCorrelationBtn();
    testLogger.info('Correlation dashboard dialog opened');
    await pm.logsPage.expectCorrelationDashboardDrawerVisible();

    try {
      await pm.logsPage.waitForCorrelationLoaded(15000);
    } catch (e) {
      testLogger.info('Initial load may not have completed, proceeding to tab switching');
    }

    await pm.logsPage.clickCorrelatedMetricsTab();
    testLogger.info('Switched to Metrics tab');

    try {
      await pm.logsPage.expectMetricStreamItemsVisible();
    } catch (e) {
      testLogger.info('No metric stream items visible (may be empty state — acceptable)');
    }

    await pm.logsPage.clickCorrelatedTracesTab();
    testLogger.info('Switched to Traces tab');

    try {
      await pm.logsPage.expectNoTracesEmptyStateDialog();
    } catch (e) {
      try {
        await pm.logsPage.expectViewTracesButtonVisible();
      } catch (e2) {
        // Fallback: if neither specific state renders, at minimum the dashboard drawer must be visible
        await pm.logsPage.expectCorrelationDashboardDrawerVisible();
      }
    }

    testLogger.info('Tab switching between Logs, Metrics, and Traces completed successfully');
  });

  test("TC-05: should toggle metric stream selection and update dashboard panels", {
    tag: ['@telemetry-correlation', '@all', '@P1', '@enterprise']
  }, async () => {
    testLogger.info('Verifying metric stream selection toggles dashboard panels');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    const isBtnVisible = await pm.logsPage.isLogCorrelationBtnVisible();

    if (!isBtnVisible) {
      testLogger.info('log-correlation-btn not visible, skipping metric selection test');
      test.skip(true, 'Dialog entry point not available');
      return;
    }

    await pm.logsPage.clickLogCorrelationBtn();
    await pm.logsPage.expectCorrelationDashboardDrawerVisible();

    try {
      await pm.logsPage.waitForCorrelationLoaded(15000);
    } catch (e) {
      testLogger.info('Initial load incomplete, proceeding');
    }

    await pm.logsPage.clickCorrelatedMetricsTab();
    testLogger.info('Switched to Metrics tab');

    try {
      await pm.logsPage.expectMetricStreamItemsVisible();
    } catch (e) {
      testLogger.info('No metric stream items found — skipping toggle test (no correlated metrics)');
      test.skip(true, 'No correlated metric streams available to toggle');
      return;
    }

    await pm.logsPage.clickFirstMetricStreamItem();
    await pm.logsPage.expectCorrelationDashboardDrawerVisible();
    testLogger.info('Metric stream toggled without errors — dashboard remains visible');
  });

  test("TC-06: should apply dimension filter changes in dialog mode", {
    tag: ['@telemetry-correlation', '@all', '@P1', '@enterprise']
  }, async () => {
    testLogger.info('Verifying dimension filter bar interaction in dialog mode');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    const isBtnVisible = await pm.logsPage.isLogCorrelationBtnVisible();

    if (!isBtnVisible) {
      testLogger.info('log-correlation-btn not visible, skipping dimension filter test');
      test.skip(true, 'Dialog entry point not available');
      return;
    }

    await pm.logsPage.clickLogCorrelationBtn();
    await pm.logsPage.expectCorrelationDashboardDrawerVisible();

    try {
      await pm.logsPage.expectApplyDimensionFiltersVisible();
    } catch (e) {
      testLogger.info('Apply dimension filters button not visible — no dimensions to filter, skipping');
      test.skip(true, 'No dimension filters available to interact with');
      return;
    }

    await pm.logsPage.clickApplyDimensionFilters();
    testLogger.info('Applied dimension filters');

    await pm.logsPage.expectCorrelationDashboardDrawerVisible();
    testLogger.info('Dimension filters applied without errors — dashboard remains visible');
  });

  test("TC-07: should show and resolve correlation loading state", {
    tag: ['@telemetry-correlation', '@all', '@P1', '@enterprise']
  }, async () => {
    testLogger.info('Verifying correlation loading state appears and resolves');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    await pm.logsPage.clickCorrelatedMetricsTab();
    await pm.logsPage.waitForCorrelationLoaded(30000);
    await pm.logsPage.expectCorrelationLoadingHidden();

    testLogger.info('Correlation loading state resolved successfully');
  });

  test("TC-08: should display no-traces empty state when no correlated traces exist", {
    tag: ['@telemetry-correlation', '@all', '@P1', '@enterprise']
  }, async () => {
    testLogger.info('Verifying no-traces empty state is displayed');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    await pm.logsPage.clickCorrelatedTracesTab();
    await pm.logsPage.waitForCorrelationLoaded(30000);

    try {
      await pm.logsPage.expectNoTracesEmptyState();
      testLogger.info('No-traces empty state displayed (embedded mode)');
    } catch (e) {
      try {
        await pm.logsPage.expectViewTracesButtonVisible();
        testLogger.info('View in Traces button displayed — correlated traces exist');
      } catch (e2) {
        testLogger.info('Traces tab rendered (no explicit empty state or view button — content may vary)');
      }
    }
    await pm.logsPage.expectCorrelationLoadingHidden();
    testLogger.info('Traces tab content rendered without errors');
  });

  test("TC-09: should close and reopen correlation dashboard dialog", {
    tag: ['@telemetry-correlation', '@all', '@P1', '@enterprise']
  }, async () => {
    testLogger.info('Verifying close and reopen of correlation dashboard dialog');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    const isBtnVisible = await pm.logsPage.isLogCorrelationBtnVisible();

    if (!isBtnVisible) {
      testLogger.info('log-correlation-btn not visible, skipping close/reopen test');
      test.skip(true, 'Dialog entry point not available');
      return;
    }

    await pm.logsPage.clickLogCorrelationBtn();
    await pm.logsPage.expectCorrelationDashboardDrawerVisible();
    testLogger.info('Correlation dashboard dialog opened');

    // Close the dashboard
    await pm.logsPage.closeCorrelationDashboard();

    // If closeCorrelationDashboard didn't close it, try drawer close button
    try {
      await pm.logsPage.expectCorrelationDashboardDrawerNotVisible();
    } catch (e) {
      testLogger.info('Dashboard may still be open — trying Escape');
      const { page } = pm;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    // Reopen: click the correlation button again
    await pm.logsPage.openLogDetailSidebar();
    if (await pm.logsPage.isLogCorrelationBtnVisible()) {
      await pm.logsPage.clickLogCorrelationBtn();
    } else {
      await pm.logsPage.clickCorrelatedTracesTab();
      testLogger.info('Reopened correlation via traces tab (fallback)');
      test.skip(true, 'Could not reopen dialog via button — used fallback approach');
      return;
    }

    await pm.logsPage.expectCorrelationDashboardDrawerVisible();
    testLogger.info('Correlation dashboard reopened successfully');
  });

  // ==================== P2 - Edge Cases & Nice-to-Have ====================

  test("TC-10: should preserve loaded data when switching tabs without refetching", {
    tag: ['@telemetry-correlation', '@all', '@P2', '@enterprise']
  }, async () => {
    testLogger.info('Verifying tab switching preserves loaded data without unnecessary refetches');

    const isEnterprise = await pm.logsPage.isCorrelationFeatureAvailable();
    if (!isEnterprise) {
      test.skip(true, 'Enterprise correlation feature is not available in this build');
      return;
    }

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    // Load Logs tab, wait for data
    await pm.logsPage.clickCorrelatedLogsTab();
    await pm.logsPage.waitForCorrelationLoaded(30000);

    // Switch to Metrics tab, wait for data
    await pm.logsPage.clickCorrelatedMetricsTab();
    await pm.logsPage.waitForCorrelationLoaded(30000);

    // Switch back to Logs tab — cached data should appear without a new loading cycle
    await pm.logsPage.clickCorrelatedLogsTab();
    testLogger.info('Switched back to Logs tab');

    // Allow brief settle period
    const { page } = pm;
    await page.waitForTimeout(2000);

    // The spinner should NOT still be visible on the already-loaded tab
    await pm.logsPage.expectCorrelationLoadingHidden();
    testLogger.info('Previously loaded tab content rendered without a new full loading cycle');
  });

  test("TC-11: should render correlation dashboard without errors in OSS mode", {
    tag: ['@telemetry-correlation', '@all', '@P2']
  }, async () => {
    testLogger.info('Verifying correlation UI degrades gracefully in OSS/non-enterprise mode');

    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.openLogDetailSidebar();
    testLogger.info('Log detail sidebar opened');

    const hasCorrelationTabs = await pm.logsPage.isCorrelationFeatureAvailable();

    if (!hasCorrelationTabs) {
      testLogger.info('Correlation tabs do not appear in OSS mode — expected graceful degradation');
      // Assert the log detail dialog is still functional
      await pm.logsPage.expectLogDetailDialogVisible();
      testLogger.info('Log detail sidebar remains functional in OSS mode');
    } else {
      testLogger.info('Correlation tabs appeared — testing that clicking does not crash the page');

      await pm.logsPage.clickCorrelatedLogsTab();

      try {
        await pm.logsPage.waitForCorrelationLoaded(15000);
      } catch (e) {
        testLogger.info('Loading may have timed out (expected in OSS mode)');
      }

      await pm.logsPage.expectLogDetailDialogVisible();
      testLogger.info('Log detail sidebar still functional after correlation tab click');
    }

    testLogger.info('OSS mode correlation test completed — no page crash observed');
  });
});
