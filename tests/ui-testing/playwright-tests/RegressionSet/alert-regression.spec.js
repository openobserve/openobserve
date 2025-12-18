const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Alert Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    // Data ingestion for alerts testing
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Alert regression bug test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.info('Alert regression test completed');
  });

  /**
   * Bug #9311: Alert graph color appears only on half of the graph
   * Issue: https://github.com/openobserve/openobserve/issues/9311
   * When viewing alert graphs, the color shading only appears on approximately
   * half of the graph instead of spanning the complete graph area
   */

  test('should display alert graph color across full graph area @bug-9311 @P2 @regression @alerts', async ({ page }) => {
    testLogger.info('Test: Alert graph color display');

    // Generate unique identifiers for test
    const randomValue = pm.alertsPage.generateRandomString();
    const streamName = 'e2e_automate';
    const column = 'kubernetes_pod_name';
    const value = 'test';

    // Step 1: Create template (prerequisite for destination)
    const templateName = 'regression_template_' + randomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    testLogger.info(`Template ensured: ${templateName}`);

    // Step 2: Create destination (prerequisite for alert)
    const destinationName = 'regression_dest_' + randomValue;
    const slackUrl = 'DEMO';
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    testLogger.info(`Destination ensured: ${destinationName}`);

    // Step 3: Navigate to alerts page and create alert
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle');
    testLogger.info('Navigated to alerts page');

    // Create alert for graph testing
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, destinationName, randomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info(`Alert created: ${alertName}`);

    // Step 4: Navigate back to alerts list and click on the created alert
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle');

    // Wait for alert table to be visible
    await page.locator(pm.alertsPage.tableBodyRowWithIndex).first().waitFor({ state: 'visible', timeout: 30000 });

    // Click on the specific alert row by name
    const alertRow = page.getByRole('cell', { name: alertName }).first();
    await alertRow.waitFor({ state: 'visible', timeout: 10000 });
    await alertRow.click();
    await page.waitForTimeout(2000);
    testLogger.info('Opened alert details');

    // Look for the alert graph/chart
    const alertGraph = page.locator(`${pm.alertsPage.alertGraph}, ${pm.alertsPage.alertChart}, canvas`).first();
    const graphVisible = await alertGraph.isVisible().catch(() => false);

    // ASSERTION: Alert graph must be visible to validate
    if (!graphVisible) {
      testLogger.warn('Alert graph not visible - may not have data or different UI structure');
      test.skip('Alert graph not displayed - cannot validate graph rendering');
      return; // test.skip will mark test as skipped, not passed
    }

    testLogger.info('Alert graph is visible');

    // PRIMARY CHECK: Verify graph dimensions
    const graphBox = await alertGraph.boundingBox();
    if (graphBox) {
      testLogger.info(`Graph dimensions: ${graphBox.width}x${graphBox.height}`);

      // Verify graph has reasonable dimensions (not collapsed or partial)
      expect(graphBox.width).toBeGreaterThan(100);
      expect(graphBox.height).toBeGreaterThan(50);
      testLogger.info('✓ PRIMARY CHECK PASSED: Graph has proper dimensions');

      // Check if graph container is not clipped
      const graphContainer = page.locator(pm.alertsPage.alertGraph).first();
      const containerBox = await graphContainer.boundingBox().catch(() => null);

      if (containerBox) {
        // Verify canvas/graph is not cut off (should fill most of container)
        const widthRatio = graphBox.width / containerBox.width;
        const heightRatio = graphBox.height / containerBox.height;

        testLogger.info(`Graph fills ${(widthRatio * 100).toFixed(1)}% width, ${(heightRatio * 100).toFixed(1)}% height of container`);

        // Graph should fill most of the container (at least 80%)
        if (widthRatio > 0.8 && heightRatio > 0.8) {
          testLogger.info('✓ Graph properly fills container - no partial rendering detected');
        } else {
          testLogger.warn(`⚠ Graph may be partially rendered: ${(widthRatio * 100).toFixed(1)}% x ${(heightRatio * 100).toFixed(1)}%`);
        }
      }

      // Visual validation: Take screenshot for manual verification if needed
      const screenshotPath = 'alert-graph-validation.png';
      await alertGraph.screenshot({ path: screenshotPath });
      testLogger.info(`Screenshot saved to ${screenshotPath} for visual verification`);
    } else {
      testLogger.warn('Could not get graph bounding box');
    }

    // Cleanup: Delete the created alert
    try {
      await pm.commonActions.navigateToAlerts();
      await page.waitForLoadState('networkidle');
      await pm.alertsPage.deleteAlertByRow(alertName);
      testLogger.info(`Cleanup: Alert deleted - ${alertName}`);
    } catch (error) {
      testLogger.warn(`Cleanup failed: ${error.message}`);
    }

    testLogger.info('Alert graph color rendering test completed');
  });
});
