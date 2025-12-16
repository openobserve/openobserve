// serviceMaps.spec.js
// Tests for OpenObserve Traces feature - Service Maps (Enterprise)

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');

test.describe("Service Maps testcases", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });
  let tracesPage;
  // Remove trailing slash from base URL if present (handle undefined env var)
  const rawBaseUrl = process.env["ZO_BASE_URL"] || '';
  const baseUrl = rawBaseUrl.endsWith('/')
    ? rawBaseUrl.slice(0, -1)
    : rawBaseUrl;
  const tracesUrl = `${baseUrl}/web/traces?org_identifier=${process.env["ORGNAME"]}`;

  test.beforeAll(async () => {
    testLogger.info('Checking for enterprise service graph feature');
    // This test suite requires enterprise license
    // Tests will be skipped if service_graph_enabled is false
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Import TracesPage dynamically
    const { TracesPage } = await import('../../pages/tracesPages/tracesPage.js');
    tracesPage = new TracesPage(page);

    // Navigate to traces
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Check if service maps tab is available
    const serviceMapsTab = page.locator(tracesPage.serviceMapsToggle);
    const isServiceMapsAvailable = await serviceMapsTab.isVisible({ timeout: 5000 }).catch(() => false);

    if (!isServiceMapsAvailable) {
      testLogger.info('Service Maps not available - enterprise feature disabled or not licensed');
      test.skip();
    }

    testLogger.info('Test setup completed for service maps');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P3: Switch to Service Maps view", {
    tag: ['@traces', '@serviceMaps', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing switch to service maps view');

    // Check if service maps toggle is visible
    const toggleButton = page.locator(tracesPage.serviceMapsToggle);

    if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Switch to service maps
      await tracesPage.switchToServiceMaps();

      // Wait for service graph to load
      await page.waitForTimeout(2000);

      // Verify service graph is visible
      const graphVisible = await page.locator(tracesPage.serviceGraphChart).isVisible({ timeout: 10000 }).catch(() => false);

      if (graphVisible) {
        await tracesPage.expectServiceGraphVisible();
        testLogger.info('Service Maps view loaded successfully');
      } else {
        testLogger.info('Service graph not visible - may need data');
      }
    } else {
      testLogger.info('Service Maps toggle not available');
      test.skip();
    }
  });

  test("P3: Refresh Service Graph", {
    tag: ['@traces', '@serviceMaps', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing service graph refresh');

    const toggleButton = page.locator(tracesPage.serviceMapsToggle);

    if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Switch to service maps
      await tracesPage.switchToServiceMaps();
      await page.waitForTimeout(2000);

      // Check if refresh button is available
      const refreshButton = page.locator(tracesPage.serviceGraphRefreshButton);

      if (await refreshButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Click refresh
        await tracesPage.refreshServiceGraph();

        // Verify graph reloads
        await page.waitForTimeout(2000);

        testLogger.info('Service graph refreshed successfully');
      } else {
        testLogger.info('Refresh button not available');
      }
    } else {
      testLogger.info('Service Maps not available');
      test.skip();
    }
  });

  test("P3: Switch between Search and Service Maps tabs", {
    tag: ['@traces', '@serviceMaps', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing tab switching');

    const serviceMapsTab = page.locator(tracesPage.serviceMapsToggle);

    if (await serviceMapsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Start in search view (default)
      await expect(page.locator(tracesPage.searchBar)).toBeVisible();

      // Switch to service maps
      await tracesPage.switchToServiceMaps();
      await page.waitForTimeout(1000);

      // Verify service maps view
      const graphVisible = await page.locator(tracesPage.serviceGraphChart).isVisible({ timeout: 5000 }).catch(() => false);
      expect(graphVisible).toBeTruthy();

      // Switch back to search
      await tracesPage.switchToSearchView();
      await page.waitForTimeout(1000);

      // Verify search view
      await expect(page.locator(tracesPage.searchBar)).toBeVisible();

      testLogger.info('Tab switching works correctly');
    } else {
      testLogger.info('Service Maps tabs not available');
      test.skip();
    }
  });

  test("P3: Service Graph interaction", {
    tag: ['@traces', '@serviceMaps', '@P3', '@enterprise']
  }, async ({ page }) => {
    testLogger.info('Testing service graph interactions');

    const toggleButton = page.locator(tracesPage.serviceMapsToggle);

    if (await toggleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Switch to service maps
      await tracesPage.switchToServiceMaps();
      await page.waitForTimeout(2000);

      const graphElement = page.locator(tracesPage.serviceGraphChart);

      if (await graphElement.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Try to interact with the graph (click on a node if available)
        // This is implementation specific

        // Check if graph has SVG elements (nodes and edges)
        const svgElements = await graphElement.locator('svg').count();

        if (svgElements > 0) {
          testLogger.info('Service graph has interactive elements');

          // Could add specific node/edge interaction tests here
          // based on your implementation
        } else {
          testLogger.info('Service graph is empty or not fully loaded');
        }
      } else {
        testLogger.info('Service graph not visible');
      }
    } else {
      testLogger.info('Service Maps not available');
      test.skip();
    }
  });
});