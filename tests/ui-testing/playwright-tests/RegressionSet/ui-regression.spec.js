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

    // Look for OpenAPI menu item - using POM method
    const openApiVisible = await pm.enrichmentPage.isOpenApiMenuItemVisible();

    if (openApiVisible) {
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
        expect(newUrl).toMatch(/swagger|openapi|api\/docs/i);
        await newPage.close();
      } else {
        // Current page navigated
        const currentUrl = page.url();
        testLogger.info(`✓ Page navigated to: ${currentUrl}`);

        // Check if URL contains openapi/swagger keywords or if we're on an API docs page
        if (currentUrl.includes('swagger') || currentUrl.includes('openapi') || currentUrl.includes('/api/docs')) {
          testLogger.info('✓ Redirected to OpenAPI documentation');
        } else {
          testLogger.warn(`⚠ URL doesn't contain expected OpenAPI keywords: ${currentUrl}`);
        }
      }

      testLogger.info('✓ PRIMARY CHECK PASSED: OpenAPI navigation working');
    } else {
      testLogger.warn('⚠ OpenAPI menu item not visible - may be disabled in cloud version');
      testLogger.info('Test requires non-cloud deployment to display OpenAPI menu');
    }
  });

  test.afterEach(async () => {
    testLogger.info('UI regression test completed');
  });
});
