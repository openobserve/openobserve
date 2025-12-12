const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

test.describe("Menu Navigation URL Validation testcases", () => {
  test.describe.configure({ mode: 'serial' });

  let pm; // Page Manager instance
  const expectedOrgId = process.env["ORGNAME"] || "default";

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to home page with org_identifier
    const homeUrl = `/?org_identifier=${expectedOrgId}`;
    testLogger.navigation('Navigating to home page', { url: homeUrl });

    await page.goto(homeUrl);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Test setup completed');
  });

  // ===== P0 TESTS (CRITICAL) =====

  test("P0: Home menu should include org_identifier in URL", {
    tag: ['@navigation', '@url-validation', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Home menu navigation with org_identifier');

    // Click Home menu item
    await pm.navigationPage.clickHome();
    await page.waitForTimeout(500);

    // Validate URL
    await pm.navigationPage.expectPath('/web/');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('Home menu navigation test completed successfully');
  });

  test("P0: Logs menu should include org_identifier in URL", {
    tag: ['@navigation', '@url-validation', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Logs menu navigation with org_identifier');

    // Click Logs menu item
    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);

    // Validate URL
    await pm.navigationPage.expectPath('/web/logs');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('Logs menu navigation test completed successfully');
  });

  test("P0: All core menu items should include org_identifier in URL", {
    tag: ['@navigation', '@url-validation', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing all core menu items for org_identifier');

    // Iterate through all core menu items
    const results = await pm.navigationPage.validateAllCoreMenusHaveOrgIdentifier(expectedOrgId);

    // Log results
    testLogger.info('Menu navigation validation results:', {
      total: results.length,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length
    });

    // Log individual results
    for (const result of results) {
      if (result.success) {
        testLogger.info(`✓ ${result.name} menu: org_identifier=${result.actualOrgId}`);
      } else if (result.skipped) {
        testLogger.warn(`⊘ ${result.name} menu: ${result.error}`);
      } else {
        testLogger.error(`✗ ${result.name} menu: ${result.error}`);
      }
    }

    // Assert all non-skipped tests passed
    const failures = results.filter(r => !r.success && !r.skipped);
    if (failures.length > 0) {
      const failureDetails = failures.map(f => `${f.name}: ${f.error}`).join(', ');
      throw new Error(`Some menu items failed validation: ${failureDetails}`);
    }

    testLogger.info('All core menu items validation completed successfully');
  });

  // ===== P1 TESTS (FUNCTIONAL) =====

  test("P1: Multiple sequential navigations should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multiple sequential navigations');

    // Navigate to Logs
    testLogger.info('Step 1: Navigate to Logs');
    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);
    await pm.navigationPage.expectPath('/web/logs');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    // Navigate to Dashboards
    testLogger.info('Step 2: Navigate to Dashboards');
    await pm.navigationPage.clickDashboards();
    await page.waitForTimeout(500);
    await pm.navigationPage.expectPath('/web/dashboards');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    // Navigate to Alerts
    testLogger.info('Step 3: Navigate to Alerts');
    await pm.navigationPage.clickAlerts();
    await page.waitForTimeout(500);
    await pm.navigationPage.expectPath('/web/alerts');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    // Navigate to Streams
    testLogger.info('Step 4: Navigate to Streams');
    await pm.navigationPage.clickStreams();
    await page.waitForTimeout(500);
    await pm.navigationPage.expectPath('/web/streams');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    // Navigate back to Home
    testLogger.info('Step 5: Navigate back to Home');
    await pm.navigationPage.clickHome();
    await page.waitForTimeout(500);
    await pm.navigationPage.expectPath('/web/');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('Multiple sequential navigations test completed successfully');
  });

  // ===== P2 TESTS (CONDITIONAL/EDGE CASES) =====

  test("P2: IAM menu should include org_identifier (if visible for admin)", {
    tag: ['@navigation', '@url-validation', '@conditional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing IAM menu navigation (admin only)');

    // Check if IAM menu is visible
    const isIAMVisible = await pm.navigationPage.isIAMVisible();

    if (!isIAMVisible) {
      testLogger.warn('IAM menu not visible - user may not be admin or feature disabled');
      testLogger.info('Skipping IAM menu test');
      test.skip();
      return;
    }

    testLogger.info('IAM menu is visible - proceeding with test');
    await pm.navigationPage.clickIAM();
    await page.waitForTimeout(500);

    await pm.navigationPage.expectPath('/web/iam');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('IAM menu navigation test completed');
  });

  test("P2: Reports menu should include org_identifier (if visible in OSS)", {
    tag: ['@navigation', '@url-validation', '@conditional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Reports menu navigation (OSS only)');

    // Check if Reports menu is visible
    const isReportsVisible = await pm.navigationPage.isReportsVisible();

    if (!isReportsVisible) {
      testLogger.warn('Reports menu not visible - may be running in cloud mode');
      testLogger.info('Skipping Reports menu test');
      test.skip();
      return;
    }

    testLogger.info('Reports menu is visible - proceeding with test');
    await pm.navigationPage.clickReports();
    await page.waitForTimeout(500);

    await pm.navigationPage.expectPath('/web/reports');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('Reports menu navigation test completed');
  });

  test("P2: Actions menu should include org_identifier (if feature enabled)", {
    tag: ['@navigation', '@url-validation', '@conditional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Actions menu navigation (if enabled)');

    // Check if Actions menu is visible
    const isActionsVisible = await pm.navigationPage.isActionsVisible();

    if (!isActionsVisible) {
      testLogger.warn('Actions menu not visible - feature may be disabled');
      testLogger.info('Skipping Actions menu test');
      test.skip();
      return;
    }

    testLogger.info('Actions menu is visible - proceeding with test');
    await pm.navigationPage.clickActions();
    await page.waitForTimeout(500);

    await pm.navigationPage.expectPath('/web/actions');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('Actions menu navigation test completed');
  });

  test("P2: Direct URL navigation should preserve org_identifier", {
    tag: ['@navigation', '@url-validation', '@edge-case', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing direct URL navigation');

    // Navigate directly to Dashboards with org_identifier
    const dashboardsUrl = `/web/dashboards?org_identifier=${expectedOrgId}`;
    testLogger.info(`Navigating directly to: ${dashboardsUrl}`);
    await page.goto(dashboardsUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Validate URL
    await pm.navigationPage.expectPath('/web/dashboards');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    // Now navigate to another page via menu
    testLogger.info('Navigating to Logs via menu');
    await pm.navigationPage.clickLogs();
    await page.waitForTimeout(500);

    // Validate org_identifier is still preserved
    await pm.navigationPage.expectPath('/web/logs');
    await pm.navigationPage.expectOrgIdentifierInURL(expectedOrgId);

    testLogger.info('Direct URL navigation test completed');
  });
});
