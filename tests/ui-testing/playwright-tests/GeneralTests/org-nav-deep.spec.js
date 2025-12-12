const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Deep Navigation URL Validation - org_identifier persistence", () => {
  test.describe.configure({ mode: 'serial' });

  let pm; // Page Manager instance
  const expectedOrgId = process.env["ORGNAME"] || "default";

  /**
   * Helper function to validate org_identifier in current URL
   */
  async function validateOrgIdentifier(page, context) {
    const url = new URL(page.url());
    const actualOrgId = url.searchParams.get('org_identifier');
    expect(actualOrgId, `org_identifier should be "${expectedOrgId}" after ${context}. URL: ${page.url()}`).toBe(expectedOrgId);
    testLogger.info(`✓ org_identifier preserved after ${context}`);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to home page with org_identifier
    const homeUrl = `/?org_identifier=${expectedOrgId}`;
    await page.goto(homeUrl);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Test setup completed');
  });

  // ===== LOGS PAGE DEEP NAVIGATION =====

  test("P0: Logs page - Query button should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@logs', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Logs page query interaction');

    // Navigate to Logs
    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Logs');

    // Click query/refresh button
    const queryButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
    if (await queryButton.isVisible({ timeout: 5000 })) {
      await queryButton.click();
      await page.waitForTimeout(1000);
      await validateOrgIdentifier(page, 'clicking query button');
    } else {
      testLogger.warn('Query button not visible - skipping interaction');
    }

    testLogger.info('Logs query interaction test completed');
  });

  test("P1: Logs page - Date/Time picker should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@logs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Logs page date/time interaction');

    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Logs');

    // Click date/time button
    const dateTimeButton = page.locator('[data-test="date-time-btn"]');
    if (await dateTimeButton.isVisible({ timeout: 5000 })) {
      await dateTimeButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening date/time picker');

      // Close picker by clicking button again
      await dateTimeButton.click();
      await page.waitForTimeout(500);
    } else {
      testLogger.warn('Date/time button not visible');
    }

    testLogger.info('Logs date/time interaction test completed');
  });

  test("P1: Logs page - SQL mode toggle should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@logs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Logs page SQL mode toggle');

    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Logs');

    // Toggle SQL mode
    const sqlModeToggle = page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]');
    if (await sqlModeToggle.isVisible({ timeout: 5000 })) {
      await sqlModeToggle.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'toggling SQL mode');
    } else {
      testLogger.warn('SQL mode toggle not visible');
    }

    testLogger.info('Logs SQL mode test completed');
  });

  test("P1: Logs page - Histogram toggle should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@logs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Logs page histogram toggle');

    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Logs');

    // Toggle histogram
    const histogramToggle = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    if (await histogramToggle.isVisible({ timeout: 5000 })) {
      await histogramToggle.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'toggling histogram');
    } else {
      testLogger.warn('Histogram toggle not visible');
    }

    testLogger.info('Logs histogram test completed');
  });

  // ===== METRICS PAGE DEEP NAVIGATION =====

  test("P1: Metrics page - Syntax guide should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@metrics', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Metrics page syntax guide interaction');

    await pm.navigationPage.clickMetrics();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Metrics');

    // Click syntax guide button
    const syntaxGuideButton = page.locator('[data-cy="syntax-guide-button"]');
    if (await syntaxGuideButton.isVisible({ timeout: 5000 })) {
      await syntaxGuideButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening syntax guide');
    } else {
      testLogger.warn('Syntax guide button not visible');
    }

    testLogger.info('Metrics syntax guide test completed');
  });

  // ===== TRACES PAGE DEEP NAVIGATION =====

  test("P1: Traces page - Date/Time picker should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@traces', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Traces page date/time interaction');

    await pm.navigationPage.clickTraces();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Traces');

    // Click date/time button
    const dateTimeButton = page.locator('[data-test="date-time-btn"]');
    if (await dateTimeButton.isVisible({ timeout: 5000 })) {
      await dateTimeButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening date/time picker in Traces');
    } else {
      testLogger.warn('Date/time button not visible in Traces');
    }

    testLogger.info('Traces date/time interaction test completed');
  });

  // ===== DASHBOARDS PAGE DEEP NAVIGATION =====

  test("P0: Dashboards page - Create dashboard button should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@dashboards', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Dashboards page create interaction');

    await pm.navigationPage.clickDashboards();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Dashboards');

    // Click create dashboard button
    const createButton = page.locator('[data-test="dashboard-add"]');
    if (await createButton.isVisible({ timeout: 5000 })) {
      await createButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening create dashboard dialog');

      // Close dialog by pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      testLogger.warn('Create dashboard button not visible');
    }

    testLogger.info('Dashboards create interaction test completed');
  });

  test("P1: Dashboards page - Search dashboard should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@dashboards', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Dashboards page search interaction');

    await pm.navigationPage.clickDashboards();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Dashboards');

    // Click and use search
    const searchInput = page.locator('[data-test="dashboard-search"]');
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.click();
      await page.waitForTimeout(300);
      await validateOrgIdentifier(page, 'clicking search input');

      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'searching dashboards');
    } else {
      testLogger.warn('Search input not visible');
    }

    testLogger.info('Dashboards search interaction test completed');
  });

  test("P1: Dashboards page - Import dashboard should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@dashboards', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Dashboards page import interaction');

    await pm.navigationPage.clickDashboards();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Dashboards');

    // Click import button
    const importButton = page.locator('[data-test="dashboard-import"]');
    if (await importButton.isVisible({ timeout: 5000 })) {
      await importButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening import dialog');

      // Close dialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      testLogger.warn('Import button not visible');
    }

    testLogger.info('Dashboards import interaction test completed');
  });

  // ===== STREAMS PAGE DEEP NAVIGATION =====

  test("P1: Streams page - Search stream should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@streams', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Streams page search interaction');

    await pm.navigationPage.clickStreams();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Streams');

    // Search for stream
    const searchInput = page.locator('[data-test="streams-search-stream-input"]').or(page.getByPlaceholder('Search Stream'));
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.click();
      await page.waitForTimeout(300);
      await validateOrgIdentifier(page, 'clicking stream search');

      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'searching streams');
    } else {
      testLogger.warn('Stream search not visible');
    }

    testLogger.info('Streams search interaction test completed');
  });

  // ===== ALERTS PAGE DEEP NAVIGATION =====

  test("P0: Alerts page - Add alert button should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@alerts', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Alerts page add alert interaction');

    await pm.navigationPage.clickAlerts();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Alerts');

    // Click add alert button
    const addAlertButton = page.locator('[data-test="alert-list-add-alert-btn"]');
    if (await addAlertButton.isVisible({ timeout: 5000 })) {
      await addAlertButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening add alert dialog');

      // Close dialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      testLogger.warn('Add alert button not visible');
    }

    testLogger.info('Alerts add interaction test completed');
  });

  test("P1: Alerts page - Tab navigation should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@alerts', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Alerts page tab navigation');

    await pm.navigationPage.clickAlerts();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Alerts');

    // Click Scheduled tab
    const scheduledTab = page.locator('[data-test="tab-scheduled"]');
    if (await scheduledTab.isVisible({ timeout: 5000 })) {
      await scheduledTab.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'clicking Scheduled tab');

      // Click Real-time tab
      const realtimeTab = page.locator('[data-test="tab-realTime"]');
      if (await realtimeTab.isVisible({ timeout: 5000 })) {
        await realtimeTab.click();
        await page.waitForTimeout(500);
        await validateOrgIdentifier(page, 'clicking Real-time tab');
      }

      // Click All tab
      const allTab = page.locator('[data-test="tab-all"]');
      if (await allTab.isVisible({ timeout: 5000 })) {
        await allTab.click();
        await page.waitForTimeout(500);
        await validateOrgIdentifier(page, 'clicking All tab');
      }
    } else {
      testLogger.warn('Alert tabs not visible');
    }

    testLogger.info('Alerts tab navigation test completed');
  });

  test("P1: Alerts page - Search alerts should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@alerts', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Alerts page search interaction');

    await pm.navigationPage.clickAlerts();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Alerts');

    // Search alerts
    const searchInput = page.locator('[data-test="alert-list-search-input"]');
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.click();
      await page.waitForTimeout(300);
      await validateOrgIdentifier(page, 'clicking alert search');

      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'searching alerts');
    } else {
      testLogger.warn('Alert search not visible');
    }

    testLogger.info('Alerts search interaction test completed');
  });

  // ===== IAM PAGE DEEP NAVIGATION (CONDITIONAL) =====

  test("P2: IAM page - Service Accounts tab should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@iam', '@conditional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing IAM page service accounts interaction');

    // Check if IAM is visible
    const isIAMVisible = await pm.navigationPage.isIAMVisible();
    if (!isIAMVisible) {
      testLogger.warn('IAM menu not visible - user may not be admin');
      test.skip();
      return;
    }

    await pm.navigationPage.clickIAM();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to IAM');

    // Click Service Accounts tab
    const serviceAccountsTab = page.locator('[data-test="iam-service-accounts-tab"]');
    if (await serviceAccountsTab.isVisible({ timeout: 5000 })) {
      await serviceAccountsTab.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'clicking Service Accounts tab');
    } else {
      testLogger.warn('Service Accounts tab not visible');
    }

    testLogger.info('IAM service accounts interaction test completed');
  });

  // ===== REPORTS PAGE DEEP NAVIGATION (CONDITIONAL) =====

  test("P2: Reports page - Scheduled tab should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@reports', '@conditional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Reports page scheduled tab interaction');

    // Check if Reports is visible
    const isReportsVisible = await pm.navigationPage.isReportsVisible();
    if (!isReportsVisible) {
      testLogger.warn('Reports menu not visible - may be cloud mode');
      test.skip();
      return;
    }

    await pm.navigationPage.clickReports();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Reports');

    // Click Scheduled tab
    const scheduledTab = page.getByTitle('Scheduled');
    if (await scheduledTab.isVisible({ timeout: 5000 })) {
      await scheduledTab.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'clicking Scheduled tab');
    } else {
      testLogger.warn('Scheduled tab not visible');
    }

    testLogger.info('Reports scheduled tab interaction test completed');
  });

  test.skip("P2: Reports page - Add report button should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@reports', '@conditional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Reports page add report interaction');

    const isReportsVisible = await pm.navigationPage.isReportsVisible();
    if (!isReportsVisible) {
      testLogger.warn('Reports menu not visible - may be cloud mode');
      test.skip();
      return;
    }

    await pm.navigationPage.clickReports();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Reports');

    // Click add report button
    const addReportButton = page.locator('[data-test="report-list-add-report-btn"]');
    if (await addReportButton.isVisible({ timeout: 5000 })) {
      await addReportButton.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'opening add report dialog');

      // Close dialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      testLogger.warn('Add report button not visible');
    }

    testLogger.info('Reports add interaction test completed');
  });

  // ===== CROSS-PAGE INTERACTION TEST =====

  test("P0: Sequential deep interactions across multiple pages should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@deep', '@cross-page', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing sequential deep interactions across pages');

    // Logs: Navigate + interact
    testLogger.info('Step 1: Logs page interaction');
    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Logs');

    const logsQueryBtn = page.locator('[data-test="logs-search-bar-refresh-btn"]');
    if (await logsQueryBtn.isVisible({ timeout: 3000 })) {
      await logsQueryBtn.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'clicking Logs query button');
    }

    // Dashboards: Navigate + interact
    testLogger.info('Step 2: Dashboards page interaction');
    await pm.navigationPage.clickDashboards();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Dashboards');

    const dashboardSearch = page.locator('[data-test="dashboard-search"]');
    if (await dashboardSearch.isVisible({ timeout: 3000 })) {
      await dashboardSearch.click();
      await page.waitForTimeout(300);
      await validateOrgIdentifier(page, 'clicking Dashboards search');
    }

    // Alerts: Navigate + interact
    testLogger.info('Step 3: Alerts page interaction');
    await pm.navigationPage.clickAlerts();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Alerts');

    const scheduledTab = page.locator('[data-test="tab-scheduled"]');
    if (await scheduledTab.isVisible({ timeout: 3000 })) {
      await scheduledTab.click();
      await page.waitForTimeout(500);
      await validateOrgIdentifier(page, 'clicking Alerts Scheduled tab');
    }

    // Streams: Navigate + interact
    testLogger.info('Step 4: Streams page interaction');
    await pm.navigationPage.clickStreams();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'navigating to Streams');

    const streamSearch = page.locator('[data-test="streams-search-stream-input"]').or(page.getByPlaceholder('Search Stream'));
    if (await streamSearch.isVisible({ timeout: 3000 })) {
      await streamSearch.click();
      await page.waitForTimeout(300);
      await validateOrgIdentifier(page, 'clicking Streams search');
    }

    // Return to Home
    testLogger.info('Step 5: Return to Home');
    await pm.navigationPage.clickHome();
    await page.waitForTimeout(500);
    await validateOrgIdentifier(page, 'returning to Home');

    testLogger.info('Cross-page sequential interactions test completed successfully');
  });
});
