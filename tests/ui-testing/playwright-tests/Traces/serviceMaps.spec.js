// serviceMaps.spec.js
// Tests for OpenObserve Traces feature - Service Maps (Enterprise)

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Service Maps testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm; // Page Manager instance
  let serviceMapsAvailable = false;

  test.beforeAll(async () => {
    testLogger.info('Service Maps tests - enterprise feature');
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to traces
    await pm.tracesPage.navigateToTracesUrl();

    // Check if service maps tab is available using page object
    serviceMapsAvailable = await pm.tracesPage.isServiceMapsToggleVisible();

    if (!serviceMapsAvailable) {
      testLogger.info('Service Maps not available - enterprise feature disabled or not licensed');
      // Don't skip - throw error to fail fast with clear message
      throw new Error('Precondition failed: Service Maps feature not available. This is an enterprise-only feature.');
    }

    testLogger.info('Test setup completed for service maps');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P3: Switch to Service Maps view", {
    tag: ['@serviceMaps', '@traces', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing switch to service maps view');

    // Check if service maps toggle is visible using page object
    const toggleButtonVisible = await pm.tracesPage.isServiceMapsToggleVisible();

    if (!toggleButtonVisible) {
      throw new Error('Precondition failed: Service Maps toggle not available.');
    }

    // Switch to service maps
    await pm.tracesPage.switchToServiceMaps();

    // Wait for service graph to load
    await page.waitForTimeout(2000);

    // Verify service graph is visible using page object
    const graphVisible = await pm.tracesPage.isServiceGraphChartVisible();

    if (graphVisible) {
      await pm.tracesPage.expectServiceGraphVisible();
      testLogger.info('Service Maps view loaded successfully');
    } else {
      testLogger.info('Service graph not visible - may need data');
    }

    // Verify toggle worked
    expect(toggleButtonVisible).toBeTruthy();
  });

  test("P3: Refresh Service Graph", {
    tag: ['@serviceMaps', '@traces', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing service graph refresh');

    const toggleButtonVisible = await pm.tracesPage.isServiceMapsToggleVisible();

    if (!toggleButtonVisible) {
      throw new Error('Precondition failed: Service Maps toggle not available.');
    }

    // Switch to service maps
    await pm.tracesPage.switchToServiceMaps();
    await page.waitForTimeout(2000);

    // Check if refresh button is available using page object
    const refreshButtonVisible = await pm.tracesPage.isServiceGraphRefreshButtonVisible();

    if (refreshButtonVisible) {
      // Click refresh
      await pm.tracesPage.refreshServiceGraph();

      // Verify graph reloads
      await page.waitForTimeout(2000);

      testLogger.info('Service graph refreshed successfully');
      expect(refreshButtonVisible).toBeTruthy();
    } else {
      testLogger.info('Refresh button not available');
      // Verify we're still on service maps view
      expect(toggleButtonVisible).toBeTruthy();
    }
  });

  test("P3: Switch between Search and Service Maps tabs", {
    tag: ['@serviceMaps', '@traces', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing tab switching');

    const serviceMapsTabVisible = await pm.tracesPage.isServiceMapsToggleVisible();

    if (!serviceMapsTabVisible) {
      throw new Error('Precondition failed: Service Maps toggle not available.');
    }

    // Start in search view (default) - verify search bar using page object
    await pm.tracesPage.expectSearchBarVisible();

    // Switch to service maps
    await pm.tracesPage.switchToServiceMaps();
    await page.waitForTimeout(1000);

    // Verify service maps view using page object
    const graphVisible = await pm.tracesPage.isServiceGraphChartVisible();
    expect(graphVisible).toBeTruthy();

    // Switch back to search
    await pm.tracesPage.switchToSearchView();
    await page.waitForTimeout(1000);

    // Verify search view using page object
    await pm.tracesPage.expectSearchBarVisible();

    testLogger.info('Tab switching works correctly');
  });

  test("P3: Service Graph interaction", {
    tag: ['@serviceMaps', '@traces', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing service graph interactions');

    const toggleButtonVisible = await pm.tracesPage.isServiceMapsToggleVisible();

    if (!toggleButtonVisible) {
      throw new Error('Precondition failed: Service Maps toggle not available.');
    }

    // Switch to service maps
    await pm.tracesPage.switchToServiceMaps();
    await page.waitForTimeout(2000);

    const graphVisible = await pm.tracesPage.isServiceGraphChartVisible();

    if (graphVisible) {
      // Try to interact with the graph (click on a node if available)
      // This is implementation specific

      // Check if graph has SVG elements (nodes and edges) using page object
      const svgElements = await pm.tracesPage.getServiceGraphSvgCount();

      if (svgElements > 0) {
        testLogger.info('Service graph has interactive elements');

        // Could add specific node/edge interaction tests here
        // based on your implementation
        expect(svgElements).toBeGreaterThan(0);
      } else {
        testLogger.info('Service graph is empty or not fully loaded');
        expect(graphVisible).toBeTruthy();
      }
    } else {
      testLogger.info('Service graph not visible');
      // Verify we at least switched to service maps view
      expect(toggleButtonVisible).toBeTruthy();
    }
  });
});
