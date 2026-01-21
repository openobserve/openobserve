/**
 * UI Regression Tests - General UI Bugs
 * Bug #9217: Favicon icon missing on main branch
 * https://github.com/openobserve/openobserve/issues/9217
 * Bug #9308: OpenAPI button redirect from Help menu
 * https://github.com/openobserve/openobserve/issues/9308
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("UI Regression Bugs", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    testLogger.info('UI regression test setup completed');
  });

  /**
   * Bug #9217: Favicon icon missing on main branch
   * Verifies that favicon is present in DOM and loads correctly via HTTP
   * https://github.com/openobserve/openobserve/issues/9217
   */
  test("Favicon is present and loads correctly (Bug #9217)", {
    tag: ['@regressionBugs', '@smoke', '@P0', '@favicon', '@bug9217']
  }, async ({ page }) => {
    testLogger.info('Test: Favicon verification (Bug #9217)');

    // Navigate to home page
    const homeUrl = `/web/?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(homeUrl);
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

    testLogger.info('Verifying favicon is present and loads correctly');

    // Verify favicon using page object method
    const faviconResult = await pm.homePage.verifyFavicon();

    // Assert favicon link exists with correct href (may be '/favicon.ico' or './favicon.ico')
    testLogger.info('Checking favicon href attribute', { href: faviconResult.faviconHref });
    expect(faviconResult.faviconHref).toMatch(/\.?\/favicon\.ico$/);
    expect(faviconResult.domValid).toBe(true);
    testLogger.info('Favicon link verified: href ends with favicon.ico');

    // Assert favicon resource loads successfully (HTTP 200)
    testLogger.info('Checking favicon resource loads via HTTP');
    expect(faviconResult.resourceLoads).toBe(true);
    testLogger.info('Favicon resource verified: HTTP 200 OK');

    testLogger.info('Bug #9217 verification complete: Favicon is present and loads correctly');
  });

  /**
   * Bug #9308: OpenAPI button redirect from Help menu
   * When clicking OpenAPI button in Help menu, should redirect to correct OpenAPI documentation page
   */
  test("should redirect to OpenAPI documentation from Help menu @bug-9308 @P1 @regressionBugs @navigation", async ({ page }) => {
    testLogger.info('Test: OpenAPI button redirect (Bug #9308)');

    // Click Help menu - using POM method
    await pm.enrichmentPage.clickHelpMenuItem();
    await page.waitForTimeout(1000);

    testLogger.info('Help menu opened');

    // Wait for OpenAPI menu item to be visible (Rule 5: no graceful skipping)
    // This test MUST validate Bug #9308 - if OpenAPI is not available, test should fail
    await pm.enrichmentPage.expectOpenApiMenuItemVisible({ timeout: 10000 });

    testLogger.info('OpenAPI menu item found');

    // Listen for navigation or new page
    const pagePromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);

    // Click OpenAPI - using POM method
    await pm.enrichmentPage.clickOpenApiMenuItemIfVisible();
    await page.waitForTimeout(2000);

    // Check if new page opened or current page navigated
    const newPage = await pagePromise;

    if (newPage) {
      // New tab opened
      const newUrl = newPage.url();
      testLogger.info(`✓ New page opened: ${newUrl}`);
      // STRONG ASSERTION: URL should contain OpenAPI/Swagger keywords
      expect(newUrl).toMatch(/swagger|openapi|api\/docs/i);
      await newPage.close();
    } else {
      // Current page navigated
      const currentUrl = page.url();
      testLogger.info(`✓ Page navigated to: ${currentUrl}`);

      // STRONG ASSERTION: URL should contain OpenAPI/Swagger keywords
      expect(currentUrl).toMatch(/swagger|openapi|api\/docs/i);
    }

    testLogger.info('✓ PRIMARY CHECK PASSED: OpenAPI navigation working');
  });

  // ==========================================================================
  // Bug #9325: Header refactored testing
  // https://github.com/openobserve/openobserve/issues/9325
  // ==========================================================================
  test("should navigate correctly via header menu links @bug-9325 @P1 @navigation @regression", async ({ page }) => {
    testLogger.info('Test: Verify header navigation (Bug #9325)');

    // STRONG ASSERTION: Logs navigation should work
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    let currentUrl = page.url();
    expect(currentUrl).toContain('logs');
    testLogger.info(`Logs URL: ${currentUrl}`);

    // STRONG ASSERTION: Streams navigation should work
    await pm.logsPage.clickMenuLinkStreamsItem();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    currentUrl = page.url();
    expect(currentUrl).toContain('streams');
    testLogger.info(`Streams URL: ${currentUrl}`);

    // STRONG ASSERTION: Pipelines navigation should work
    await pm.pipelinesPage.openPipelineMenu();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    currentUrl = page.url();
    expect(currentUrl).toContain('pipeline');
    testLogger.info(`Pipelines URL: ${currentUrl}`);

    testLogger.info('✓ PASSED: Header navigation works correctly');
  });

  // ==========================================================================
  // Bug #9565: About section not including org identifier
  // https://github.com/openobserve/openobserve/issues/9565
  // ==========================================================================
  test("should preserve org_identifier across navigations @bug-9565 @P1 @navigation @regression", async ({ page }) => {
    testLogger.info('Test: Verify org_identifier preserved (Bug #9565)');

    const orgName = process.env["ORGNAME"] || 'default';

    // Start with org_identifier in URL
    const logsUrl = `/web/logs?org_identifier=${orgName}`;
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle');

    const initialUrl = page.url();
    testLogger.info(`Initial URL: ${initialUrl}`);

    // STRONG ASSERTION: Initial URL should have org_identifier
    expect(initialUrl).toContain('org_identifier');

    // Navigate to streams
    await pm.logsPage.clickMenuLinkStreamsItem();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    let currentUrl = page.url();
    testLogger.info(`After Streams navigation: ${currentUrl}`);

    // STRONG ASSERTION: URL should still contain org_identifier
    expect(currentUrl).toContain('org_identifier');

    // Navigate back to logs
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    currentUrl = page.url();
    testLogger.info(`After Logs navigation: ${currentUrl}`);

    // STRONG ASSERTION: URL should still contain org_identifier
    expect(currentUrl).toContain('org_identifier');

    testLogger.info('✓ PASSED: Org context preserved');
  });

  test.afterEach(async () => {
    testLogger.info('UI regression test completed');
  });
});
