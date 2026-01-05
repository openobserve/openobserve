const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
const logData = require("../../fixtures/log.json");

test.describe("Metrics Query Persistence testcases", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  const TEST_DASHBOARD_NAME = `MetricsQueryPersistence_${Math.random().toString(36).substr(2, 9)}`;

  // Test data: Metrics streams and queries
  const METRICS_STREAMS = {
    stream1: "prometheus_http_requests_total",
    stream2: "node_cpu_seconds_total",
    stream3: "go_memstats_alloc_bytes",
  };

  const SAMPLE_QUERIES = {
    query1: "prometheus_http_requests_total{code=\"200\"}",
    query2: "node_cpu_seconds_total{mode=\"idle\"}",
    query3: "go_memstats_alloc_bytes{job=\"prometheus\"}",
    query4: "prometheus_http_requests_total{code=\"500\"}",
  };

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    testLogger.info("Test setup completed");
  });

  test.afterAll(async ({ page }) => {
    testLogger.info(`Cleaning up test dashboard: ${TEST_DASHBOARD_NAME}`);
    try {
      await pm.apiCleanup.deleteDashboardByName(TEST_DASHBOARD_NAME);
      testLogger.info("Cleanup completed");
    } catch (error) {
      testLogger.warn(`Cleanup failed: ${error.message}`);
    }
  });

  // ====================================================================
  // P0 - CRITICAL PATH (SMOKE TESTS)
  // ====================================================================

  test("Query tabs visible in PromQL mode", {
    tag: ["@metricsQueryPersistence", "@dashboard", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing query tabs visibility in PromQL mode");

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(TEST_DASHBOARD_NAME);
    await pm.dashboardCreate.addPanel();

    // Select metrics chart configuration
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Select a metrics stream (try multiple times if needed)
    let streamSelected = false;
    const streamsToTry = Object.values(METRICS_STREAMS);

    for (const stream of streamsToTry) {
      try {
        testLogger.info(`Attempting to select stream: ${stream}`);
        await pm.chartTypeSelector.selectStream(stream);
        streamSelected = true;
        testLogger.info(`Successfully selected stream: ${stream}`);
        break;
      } catch (error) {
        testLogger.warn(`Failed to select stream ${stream}: ${error.message}`);
      }
    }

    if (!streamSelected) {
      testLogger.error("Could not select any metrics stream");
      throw new Error("No metrics streams available for testing");
    }

    // Wait for query editor to initialize
    await pm.dashboardQueryTabs.waitForQueryEditorReady();

    // ASSERTION 1: Query tabs container visible
    await pm.dashboardQueryTabs.expectQueryTabsVisible();
    testLogger.info("✓ Query tabs container visible");

    // ASSERTION 2: Query 1 tab visible
    const query1Exists = await pm.dashboardQueryTabs.queryTabExists(0);
    expect(query1Exists).toBe(true);
    testLogger.info("✓ Query 1 tab exists");

    // ASSERTION 3: Add tab button visible
    await expect(page.locator('[data-test="dashboard-panel-query-tab-add"]')).toBeVisible();
    testLogger.info("✓ Add query tab button visible");

    // ASSERTION 4: Query editor visible
    await expect(page.locator('[data-test="dashboard-panel-query-editor"]')).toBeVisible();
    testLogger.info("✓ Query editor visible");

    testLogger.info("Test completed successfully");
  });

  test("Basic query persistence between 2 tabs (CORE BUG FIX)", {
    tag: ["@metricsQueryPersistence", "@dashboard", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing query persistence between tabs - THE CORE BUG FIX");

    // Reuse dashboard from previous test
    await page.locator(`[aria-label="${TEST_DASHBOARD_NAME}"]`).first().click();
    await page.waitForTimeout(2000);

    // Edit the panel
    const panelName = await page.locator('[data-test^="dashboard-edit-panel-"]').first().getAttribute('data-test');
    const extractedPanelName = panelName.match(/dashboard-edit-panel-(.+)-dropdown/)?.[1];

    if (extractedPanelName) {
      await pm.dashboardPanelEdit.editPanel(extractedPanelName);
    } else {
      testLogger.warn("Could not extract panel name, using direct edit");
      await page.locator('[data-test="dashboard-edit-panel"]').first().click();
    }

    await page.waitForTimeout(2000);

    // STEP 1: Get default query in Query 1
    await pm.dashboardQueryTabs.switchQueryTab(0);
    const defaultQuery1 = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Default Query 1: ${defaultQuery1}`);

    // STEP 2: Edit Query 1 to add filter
    const customQuery1 = defaultQuery1.replace(/{.*}/, '{code="200"}');
    await pm.dashboardQueryTabs.setQueryEditorValue(customQuery1);
    await page.waitForTimeout(1000);

    // Verify Query 1 was set correctly
    const query1AfterEdit = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 1 after edit: ${query1AfterEdit}`);
    expect(query1AfterEdit).toContain('code="200"');
    testLogger.info("✓ Query 1 edited successfully");

    // STEP 3: Add Query Tab 2
    const newTabIndex = await pm.dashboardQueryTabs.addQueryTab();
    expect(newTabIndex).toBe(1);
    testLogger.info("✓ Query 2 tab created");

    // STEP 4: Verify Query 2 tab is active
    const activeIndex = await pm.dashboardQueryTabs.getActiveQueryIndex();
    expect(activeIndex).toBe(1);
    testLogger.info("✓ Query 2 tab is active");

    // STEP 5: Edit Query 2
    const defaultQuery2 = await pm.dashboardQueryTabs.getQueryEditorValue();
    const customQuery2 = defaultQuery2.replace(/{.*}/, '{code="500"}');
    await pm.dashboardQueryTabs.setQueryEditorValue(customQuery2);
    await page.waitForTimeout(1000);

    const query2AfterEdit = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 2 after edit: ${query2AfterEdit}`);
    expect(query2AfterEdit).toContain('code="500"');
    testLogger.info("✓ Query 2 edited successfully");

    // STEP 6: Switch back to Query 1
    await pm.dashboardQueryTabs.switchQueryTab(0);
    await page.waitForTimeout(1500); // Wait for tab switch and potential watcher execution

    // STEP 7: CRITICAL ASSERTION - Query 1 should NOT be reset
    const query1AfterSwitch = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 1 after returning from Query 2: ${query1AfterSwitch}`);

    // THE CORE BUG FIX VALIDATION
    expect(query1AfterSwitch).toContain('code="200"');
    expect(query1AfterSwitch).not.toContain('code="500"');
    expect(query1AfterSwitch).toBe(query1AfterEdit);
    testLogger.info("✓✓✓ CORE BUG FIX VALIDATED: Query 1 persisted correctly ✓✓✓");

    // STEP 8: Verify Query 2 is also intact
    await pm.dashboardQueryTabs.switchQueryTab(1);
    await page.waitForTimeout(1000);
    const query2Verification = await pm.dashboardQueryTabs.getQueryEditorValue();
    expect(query2Verification).toContain('code="500"');
    testLogger.info("✓ Query 2 also persisted correctly");

    testLogger.info("Test completed successfully - Bug fix confirmed working");
  });

  test("Add new query tab creates default query", {
    tag: ["@metricsQueryPersistence", "@dashboard", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing new query tab creation with default query");

    // Reuse dashboard from previous test
    await page.locator(`[aria-label="${TEST_DASHBOARD_NAME}"]`).first().click();
    await page.waitForTimeout(2000);

    // Edit the panel
    const panelName = await page.locator('[data-test^="dashboard-edit-panel-"]').first().getAttribute('data-test');
    const extractedPanelName = panelName.match(/dashboard-edit-panel-(.+)-dropdown/)?.[1];

    if (extractedPanelName) {
      await pm.dashboardPanelEdit.editPanel(extractedPanelName);
    }

    await page.waitForTimeout(2000);

    // Get the current stream name from Query 1
    const currentQuery = await pm.dashboardQueryTabs.getQueryEditorValue();
    const streamMatch = currentQuery.match(/^([^{]+)/);
    const currentStream = streamMatch ? streamMatch[1] : "";
    testLogger.info(`Current stream: ${currentStream}`);

    // Count existing query tabs
    const tabsBeforeAdd = await page.locator('[data-test^="dashboard-panel-query-tab-"][data-test$="]').count();
    testLogger.info(`Existing query tabs: ${tabsBeforeAdd}`);

    // STEP 1: Add new query tab
    const newTabIndex = await pm.dashboardQueryTabs.addQueryTab();
    testLogger.info(`New tab created at index: ${newTabIndex}`);

    // STEP 2: Verify new tab appears and is active
    const newTabExists = await pm.dashboardQueryTabs.queryTabExists(newTabIndex);
    expect(newTabExists).toBe(true);
    testLogger.info("✓ New query tab exists");

    const activeIndex = await pm.dashboardQueryTabs.getActiveQueryIndex();
    expect(activeIndex).toBe(newTabIndex);
    testLogger.info("✓ New query tab is active");

    // STEP 3: Verify default query is set
    const newTabQuery = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`New tab query: ${newTabQuery}`);

    // Default query should be: {streamName}{}
    expect(newTabQuery).toContain(currentStream);
    expect(newTabQuery).toContain("{}");
    testLogger.info("✓ Default query set correctly");

    // STEP 4: Verify Query 1 still exists and retains data
    await pm.dashboardQueryTabs.switchQueryTab(0);
    const query1AfterAdd = await pm.dashboardQueryTabs.getQueryEditorValue();
    expect(query1AfterAdd).toContain('code="200"');
    testLogger.info("✓ Query 1 still intact after adding new tab");

    testLogger.info("Test completed successfully");
  });

  test("Remove query tab maintains other queries", {
    tag: ["@metricsQueryPersistence", "@dashboard", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing query tab removal maintains other queries");

    // Reuse dashboard from previous test
    await page.locator(`[aria-label="${TEST_DASHBOARD_NAME}"]`).first().click();
    await page.waitForTimeout(2000);

    // Edit the panel
    const panelName = await page.locator('[data-test^="dashboard-edit-panel-"]').first().getAttribute('data-test');
    const extractedPanelName = panelName.match(/dashboard-edit-panel-(.+)-dropdown/)?.[1];

    if (extractedPanelName) {
      await pm.dashboardPanelEdit.editPanel(extractedPanelName);
    }

    await page.waitForTimeout(2000);

    // STEP 1: Create Query 3 with unique content
    await pm.dashboardQueryTabs.addQueryTab();
    const currentQuery = await pm.dashboardQueryTabs.getQueryEditorValue();
    const query3Custom = currentQuery.replace(/{.*}/, '{job="prometheus"}');
    await pm.dashboardQueryTabs.setQueryEditorValue(query3Custom);
    await page.waitForTimeout(1000);

    const query3Saved = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 3 content: ${query3Saved}`);
    expect(query3Saved).toContain('job="prometheus"');
    testLogger.info("✓ Query 3 created with custom content");

    // STEP 2: Verify we have 3 queries
    const tabsBeforeRemove = await page.locator('[data-test^="dashboard-panel-query-tab-"][data-test$="]').count();
    expect(tabsBeforeRemove).toBeGreaterThanOrEqual(3);
    testLogger.info(`Total query tabs before removal: ${tabsBeforeRemove}`);

    // STEP 3: Remove Query 2 (middle tab)
    await pm.dashboardQueryTabs.removeQueryTab(1);
    await page.waitForTimeout(1000);

    const tabsAfterRemove = await page.locator('[data-test^="dashboard-panel-query-tab-"][data-test$="]').count();
    expect(tabsAfterRemove).toBe(tabsBeforeRemove - 1);
    testLogger.info("✓ Query 2 removed successfully");

    // STEP 4: Verify Query 1 is intact
    await pm.dashboardQueryTabs.switchQueryTab(0);
    await page.waitForTimeout(1000);
    const query1AfterRemove = await pm.dashboardQueryTabs.getQueryEditorValue();
    expect(query1AfterRemove).toContain('code="200"');
    testLogger.info("✓ Query 1 intact after Query 2 removal");

    // STEP 5: Verify Query 3 is intact (now at index 1)
    await pm.dashboardQueryTabs.switchQueryTab(1);
    await page.waitForTimeout(1000);
    const query3AfterRemove = await pm.dashboardQueryTabs.getQueryEditorValue();
    expect(query3AfterRemove).toContain('job="prometheus"');
    testLogger.info("✓ Query 3 (now Query 2) intact after removal");

    testLogger.info("Test completed successfully");
  });

  test("Query persists after panel apply and edit", {
    tag: ["@metricsQueryPersistence", "@dashboard", "@smoke", "@P0"],
  }, async ({ page }) => {
    testLogger.info("Testing query persistence through save/load cycle");

    // Reuse dashboard from previous test
    await page.locator(`[aria-label="${TEST_DASHBOARD_NAME}"]`).first().click();
    await page.waitForTimeout(2000);

    // Edit the panel
    const panelName = await page.locator('[data-test^="dashboard-edit-panel-"]').first().getAttribute('data-test');
    const extractedPanelName = panelName.match(/dashboard-edit-panel-(.+)-dropdown/)?.[1];

    if (extractedPanelName) {
      await pm.dashboardPanelEdit.editPanel(extractedPanelName);
    }

    await page.waitForTimeout(2000);

    // STEP 1: Capture current query content from both tabs
    await pm.dashboardQueryTabs.switchQueryTab(0);
    const query1BeforeSave = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 1 before save: ${query1BeforeSave}`);

    await pm.dashboardQueryTabs.switchQueryTab(1);
    const query2BeforeSave = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 2 before save: ${query2BeforeSave}`);

    // STEP 2: Apply panel (render chart)
    await pm.dashboardPanelActions.applyDashboardBtn();
    await page.waitForTimeout(3000); // Wait for chart rendering

    testLogger.info("✓ Panel applied successfully");

    // STEP 3: Save panel
    await pm.dashboardPanelActions.addPanelName("QueryPersistenceTest");
    await pm.dashboardPanelActions.savePanel();
    await page.waitForTimeout(2000);

    testLogger.info("✓ Panel saved successfully");

    // STEP 4: Edit panel again
    if (extractedPanelName) {
      await pm.dashboardPanelEdit.editPanel("QueryPersistenceTest");
    } else {
      await page.locator('[data-test="dashboard-edit-panel"]').first().click();
    }

    await page.waitForTimeout(2000);

    // STEP 5: Verify Query 1 restored
    await pm.dashboardQueryTabs.switchQueryTab(0);
    await page.waitForTimeout(1000);
    const query1AfterRestore = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 1 after restore: ${query1AfterRestore}`);

    expect(query1AfterRestore).toBe(query1BeforeSave);
    expect(query1AfterRestore).toContain('code="200"');
    testLogger.info("✓ Query 1 restored correctly");

    // STEP 6: Verify Query 2 restored
    await pm.dashboardQueryTabs.switchQueryTab(1);
    await page.waitForTimeout(1000);
    const query2AfterRestore = await pm.dashboardQueryTabs.getQueryEditorValue();
    testLogger.info(`Query 2 after restore: ${query2AfterRestore}`);

    expect(query2AfterRestore).toBe(query2BeforeSave);
    testLogger.info("✓ Query 2 restored correctly");

    testLogger.info("Test completed successfully - Queries persist through save/load cycle");
  });
});
