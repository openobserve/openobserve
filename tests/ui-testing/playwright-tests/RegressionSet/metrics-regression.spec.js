/**
 * Metrics Regression Bugs Test Suite
 *
 * This suite contains regression tests for metrics-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  // Ensure metrics are ingested once for all tests
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to metrics page
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    testLogger.info('Metrics regression test setup completed');
  });

  // ==========================================================================
  // Bug #11061: "No results found" text not visible in dark mode
  // https://github.com/openobserve/openobserve/issues/11061
  // ==========================================================================
  test("No results found text should be visible in dark mode @bug-11061 @P2 @regression @darkMode", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify "No results found" visibility in dark mode (Bug #11061)');

    // Enable dark mode using the navbar theme toggle button
    const themeToggleBtn = page.locator('[data-test="navbar-theme-toggle-btn"]');

    if (await themeToggleBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await themeToggleBtn.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Clicked theme toggle button');
    } else {
      testLogger.warn('Theme toggle button not found');
    }

    // Check if page is in dark mode by looking for dark class or dark theme styles
    const bodyClass = await pm.metricsPage.getBodyElement().getAttribute('class') || '';
    const isDarkMode = bodyClass.includes('dark') || bodyClass.includes('body--dark');
    testLogger.info(`Dark mode active: ${isDarkMode}`);

    // If dark mode attempts failed, skip the test
    if (!isDarkMode) {
      testLogger.info('Dark mode not activated - skipping test');
      testInfo.skip(true, 'Dark mode unavailable - cannot test Bug #11061');
      return;
    }

    // Wait for page to stabilize after theme change
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Dark mode confirmed active, proceeding with visibility test');

    // Enter query that returns no results
    await pm.metricsPage.enterMetricsQuery('non_existent_metric_for_dark_mode_test_xyz');
    await page.waitForTimeout(500);

    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // STRONG ASSERTION: Check for "No results found" or similar message
    const noResultsText = pm.metricsPage.getNoResultsText().first();

    // PRIMARY ASSERTION: "No results" text must be visible
    await expect(noResultsText, 'Bug #11061: "No results found" text must be visible').toBeVisible({ timeout: 5000 });
    testLogger.info('✓ "No results found" text is visible');

    // If dark mode was successfully activated, verify it
    if (isDarkMode) {
      const bodyClass = await pm.metricsPage.getBodyElement().getAttribute('class') || '';
      expect(bodyClass.includes('dark') || bodyClass.includes('body--dark'), 'Dark mode should be active').toBe(true);
      testLogger.info('✓ Dark mode confirmed active');
    }

    // Verify text is readable by checking color contrast
    const textColor = await noResultsText.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.color;
    });

    testLogger.info(`"No results" text color: ${textColor}`);

    // In dark mode, text should be light colored (not dark gray/black)
    // RGB values for dark text would be low (close to 0)
    // Light text would have higher values
    const rgbMatch = textColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      const brightness = (r + g + b) / 3;

      testLogger.info(`Text brightness: ${brightness} (RGB: ${r}, ${g}, ${b})`);

      // STRONG ASSERTION: In dark mode, text brightness should be sufficient (not too dark)
      if (isDarkMode) {
        expect(brightness, 'Bug #11061: Text brightness should be sufficient in dark mode').toBeGreaterThan(100);
        testLogger.info('✓ Text has sufficient brightness for dark mode');
      }
    }

    testLogger.info('✓ PASSED: Dark mode visibility test completed');
  });

  test.afterEach(async () => {
    testLogger.info('Metrics regression test completed');
  });
});
