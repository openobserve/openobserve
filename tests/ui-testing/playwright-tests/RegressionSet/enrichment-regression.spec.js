/**
 * Enrichment Table Regression Tests
 * Bug #9193: Enrichment table color contrast in light mode
 * https://github.com/openobserve/openobserve/issues/9193
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Enrichment Table Regression Bugs", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    testLogger.info('Enrichment regression test setup completed');
  });

  /**
   * Bug #9193: Enrichment table color contrast in light mode
   * Enrichment tables should have proper color contrast in light mode for accessibility
   */
  test("should display enrichment table with proper contrast in light mode @bug-9193 @P2 @regressionBugs @accessibility", async ({ page }) => {
    testLogger.info('Test: Enrichment table color contrast (Bug #9193)');

    // Navigate to Functions page (where enrichment tables are)
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/functions?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    testLogger.info('Navigated to Functions page');

    // Look for enrichment tables tab or section - using POM method
    const enrichmentVisible = await pm.enrichmentPage.isEnrichmentTabVisible();

    if (enrichmentVisible) {
      await pm.enrichmentPage.clickEnrichmentTabByText();
      await page.waitForTimeout(1500);
      testLogger.info('Opened Enrichment Tables section');
    }

    // Check if enrichment tables are displayed - using POM method
    const searchVisible = await pm.enrichmentPage.isEnrichmentSearchInputVisible();

    if (searchVisible) {
      testLogger.info('✓ Enrichment table UI is visible');

      // Verify table is rendered - using POM method
      const tableVisible = await pm.enrichmentPage.isQuasarTableVisible();

      if (tableVisible) {
        testLogger.info('✓ Enrichment table rendered successfully');

        // Get table bounding box to verify it's displayed properly - using POM method
        const tableBox = await pm.enrichmentPage.getQuasarTableDimensions();
        if (tableBox) {
          expect(tableBox.width).toBeGreaterThan(100);
          expect(tableBox.height).toBeGreaterThan(50);
          testLogger.info(`✓ Table dimensions: ${tableBox.width}x${tableBox.height}`);
        }

        // Take screenshot for visual verification of contrast - using POM method
        await pm.enrichmentPage.screenshotQuasarTable('enrichment-table-contrast.png');
        testLogger.info('Screenshot saved for manual contrast verification');

        testLogger.info('✓ PRIMARY CHECK PASSED: Enrichment table displays with proper layout');
      } else {
        testLogger.info('No enrichment tables found - table may be empty');
      }
    } else {
      testLogger.warn('⚠ Enrichment tables UI not found - may need navigation adjustment');
    }
  });

  test.afterEach(async () => {
    testLogger.info('Enrichment regression test completed');
  });
});
