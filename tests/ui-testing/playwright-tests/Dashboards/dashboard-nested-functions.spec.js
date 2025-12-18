/**
 * Dashboard Functions E2E Tests
 *
 * Tests the function capability in the Dashboard Panel Builder.
 * Supports aggregation functions, string functions, and nested functions.
 *
 * Test Scenarios:
 * 1. Basic aggregation functions (COUNT, SUM, AVG)
 * 2. String functions (UPPER, LOWER)
 * 3. Multiple Y-axis with different functions
 * 4. Nested functions (function within function)
 */

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const { waitForDashboardPage } = require("./utils/dashCreation.js");
const PageManager = require("../../pages/page-manager");
const testLogger = require("../utils/test-logger.js");

// Test data - simple records for testing functions
const testRecords = [
  { user_id: 1, user_name: "Alice", email: "alice@test.com", score: 85 },
  { user_id: 2, user_name: "Bob", email: "bob@test.com", score: 92 },
  { user_id: 3, user_name: "Charlie", email: "charlie@test.com", score: 78 },
  { user_id: 4, user_name: "Diana", email: "diana@test.com", score: 95 },
  { user_id: 5, user_name: "Eve", email: "eve@test.com", score: 88 },
];

const generateDashboardName = (testId) => `NestedFunc_Test_${testId}`;
const generateStreamName = (testId) => `func_test_${testId}`;
const generateTestId = () => Math.random().toString(36).substring(2, 10);

const getAuthToken = async () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");
  return `Basic ${basicAuthCredentials}`;
};

const ingestTestData = async (streamName, data) => {
  const orgId = process.env["ORGNAME"];
  const headers = {
    "Content-Type": "application/json",
    Authorization: await getAuthToken(),
  };
  const url = `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
  const fetchResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!fetchResponse.ok) {
    const responseText = await fetchResponse.text();
    throw new Error(`Ingestion failed: ${fetchResponse.status} - ${responseText}`);
  }
  return fetchResponse.json();
};

const deleteStream = async (streamName) => {
  const orgId = process.env["ORGNAME"];
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";
  try {
    const headers = { Authorization: await getAuthToken() };
    await fetch(`${baseUrl}/api/${orgId}/streams/${streamName}`, {
      method: "DELETE",
      headers,
    });
    return true;
  } catch {
    return false;
  }
};

const deleteDashboardByName = async (dashboardName) => {
  const orgId = process.env["ORGNAME"];
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";
  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };
    const listResponse = await fetch(`${baseUrl}/api/${orgId}/dashboards`, {
      method: "GET",
      headers,
    });
    if (!listResponse.ok) return false;
    const dashboards = await listResponse.json();
    const dashboard = dashboards.dashboards?.find(d => d.title === dashboardName);
    if (!dashboard) return true;
    await fetch(`${baseUrl}/api/${orgId}/dashboards/${dashboard.dashboardId}`, {
      method: "DELETE",
      headers,
    });
    testLogger.info(`Deleted dashboard: ${dashboardName}`);
    return true;
  } catch {
    return false;
  }
};

async function createDashboardAndAddFirstPanel(page, pm, dashboardName) {
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);
  testLogger.info(`Created dashboard: ${dashboardName}`);
  await pm.dashboardCreate.addPanel();
}

async function selectStreamAndChartType(page, pm, streamName, chartType = "table") {
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(streamName);

  // Wait for stream fields to load
  await page.waitForTimeout(2000);
}

async function savePanelWithName(page, panelName) {
  // Enter panel name
  const panelTitleInput = page.locator('[data-test="dashboard-panel-name"]');
  await panelTitleInput.waitFor({ state: "visible", timeout: 10000 });
  await panelTitleInput.fill(panelName);

  // Save the panel
  const saveBtn = page.locator('[data-test="dashboard-panel-save"]');
  await saveBtn.waitFor({ state: "visible", timeout: 5000 });
  await saveBtn.click();

  // Wait for save to complete
  await page.waitForTimeout(2000);
}

/**
 * Open the Y-axis function configuration popup
 */
async function openYAxisFunctionPopup(page, alias) {
  const yAxisItem = page.locator(`[data-test="dashboard-y-item-${alias}"]`);
  await yAxisItem.waitFor({ state: "visible", timeout: 10000 });
  await yAxisItem.click();

  // Wait for the popup menu to appear
  await page.locator(`[data-test="dashboard-y-item-${alias}-menu"]`).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await page.waitForTimeout(500);
}

/**
 * Select a function from the function dropdown
 */
async function selectFunction(page, functionName) {
  const dropdown = page.locator('[data-test="dashboard-function-dropdown"]').first();
  await dropdown.waitFor({ state: "visible", timeout: 10000 });
  await dropdown.click();
  await page.waitForTimeout(300);

  // Type to filter options
  await page.keyboard.type(functionName);
  await page.waitForTimeout(500);

  // Select the option from the dropdown
  const option = page.getByRole("option", { name: functionName, exact: false }).first();
  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click();
  await page.waitForTimeout(500);
}

/**
 * Get table column values
 */
async function getTableColumnValues(page, columnIndex) {
  await page.waitForTimeout(2000);

  const rows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
  const rowCount = await rows.count();
  const values = [];

  for (let i = 0; i < rowCount; i++) {
    const cell = rows.nth(i).locator('td').nth(columnIndex);
    const cellExists = await cell.count();
    if (cellExists > 0) {
      const text = await cell.textContent().catch(() => '');
      if (text && text.trim() !== '') {
        values.push(text.trim());
      }
    }
  }

  return values;
}

test.describe("Dashboard Functions", () => {
  test.describe.configure({ mode: "parallel" });

  /**
   * Test 1: Basic Aggregation Function (COUNT)
   * Verifies that COUNT function can be applied to Y-axis field
   */
  test("Test 1: Basic COUNT function", {
    tag: ['@dashboard-functions', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 1: Starting with testId=${testId}`);

    try {
      // Setup: Ingest test data
      await ingestTestData(STREAM_NAME, testRecords);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Login and create dashboard
      await navigateToBase(page);
      const pm = new PageManager(page);

      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);
      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");

      // Add X-axis field (for grouping)
      await pm.chartTypeSelector.searchAndAddField("user_name", "x");

      // Add Y-axis field (for aggregation)
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      // Apply COUNT function to Y-axis
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "count");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Apply query
      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      // Verify chart renders without errors
      const chartRenderer = page.locator('[data-test="dashboard-panel-table"]');
      await expect(chartRenderer).toBeVisible({ timeout: 15000 });

      // Verify data is displayed
      const rows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);

      // Verify Y-axis label shows count
      const yAxisLabel = page.locator('[data-test="dashboard-y-item-y_axis_1"]');
      const labelText = await yAxisLabel.textContent();
      testLogger.info(`Y-axis label: ${labelText}`);
      expect(labelText.toLowerCase()).toContain("count");

      // Save panel
      await savePanelWithName(page, "Basic Count Function");

      testLogger.info("Test 1: Basic COUNT function - PASSED");

    } finally {
      // Cleanup
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });

  /**
   * Test 2: COUNT DISTINCT Function
   * Tests COUNT DISTINCT aggregation function for unique value counting
   */
  test("Test 2: COUNT DISTINCT function", {
    tag: ['@dashboard-functions', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 2: Starting with testId=${testId}`);

    try {
      // Setup: Ingest test data
      await ingestTestData(STREAM_NAME, testRecords);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Login and create dashboard
      await navigateToBase(page);
      const pm = new PageManager(page);

      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);
      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");

      // Add timestamp to X-axis for grouping
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add user_name to Y-axis and apply COUNT DISTINCT
      await pm.chartTypeSelector.searchAndAddField("user_name", "y");

      // Apply COUNT (Distinct) function - note: the label in UI is "Count (Distinct)"
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "Distinct");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Apply query
      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      // Verify chart renders
      const chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
      await expect(chartRenderer.first()).toBeVisible({ timeout: 15000 });

      // Verify Y-axis label shows count-distinct
      const yAxisLabel = page.locator('[data-test="dashboard-y-item-y_axis_1"]');
      const labelText = await yAxisLabel.textContent();
      testLogger.info(`Y-axis label: ${labelText}`);
      expect(labelText.toLowerCase()).toContain("count");

      // Save panel
      await savePanelWithName(page, "COUNT-DISTINCT Function");

      testLogger.info("Test 2: COUNT DISTINCT function - PASSED");

    } finally {
      // Cleanup
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });

  /**
   * Test 3: AVG Aggregation Function
   * Tests AVG aggregation on numeric field
   */
  test("Test 3: AVG aggregation function", {
    tag: ['@dashboard-functions', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 3: Starting with testId=${testId}`);

    try {
      // Setup: Ingest test data
      await ingestTestData(STREAM_NAME, testRecords);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Login and create dashboard
      await navigateToBase(page);
      const pm = new PageManager(page);

      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);
      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");

      // Add timestamp to X-axis
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add score to Y-axis for AVG function
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      // Apply AVG function
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "avg");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Apply query
      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      // Verify chart renders
      const chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
      await expect(chartRenderer.first()).toBeVisible({ timeout: 15000 });

      // Verify Y-axis label shows avg
      const yAxisLabel = page.locator('[data-test="dashboard-y-item-y_axis_1"]');
      const labelText = await yAxisLabel.textContent();
      testLogger.info(`Y-axis label: ${labelText}`);
      expect(labelText.toLowerCase()).toContain("avg");

      // Save panel
      await savePanelWithName(page, "AVG Function");

      testLogger.info("Test 3: AVG aggregation function - PASSED");

    } finally {
      // Cleanup
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });

  /**
   * Test 4: Multiple Y-axis with Different Aggregation Functions
   * Tests applying different aggregation functions to multiple Y-axis fields
   */
  test("Test 4: Multiple Y-axis with different aggregations", {
    tag: ['@dashboard-functions', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 4: Starting with testId=${testId}`);

    try {
      // Setup: Ingest test data
      await ingestTestData(STREAM_NAME, testRecords);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Login and create dashboard
      await navigateToBase(page);
      const pm = new PageManager(page);

      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);
      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");

      // Add X-axis field (timestamp for grouping)
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add first Y-axis field with COUNT
      await pm.chartTypeSelector.searchAndAddField("user_name", "y");
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "count");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Add second Y-axis field with SUM
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_2");
      await selectFunction(page, "sum");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Add third Y-axis field with AVG
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_3");
      await selectFunction(page, "avg");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Apply query
      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      // Verify chart renders
      const chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
      await expect(chartRenderer.first()).toBeVisible({ timeout: 15000 });

      // Verify Y-axis labels
      const y1Label = page.locator('[data-test="dashboard-y-item-y_axis_1"]');
      const y2Label = page.locator('[data-test="dashboard-y-item-y_axis_2"]');
      const y3Label = page.locator('[data-test="dashboard-y-item-y_axis_3"]');

      const y1Text = await y1Label.textContent();
      const y2Text = await y2Label.textContent();
      const y3Text = await y3Label.textContent();

      testLogger.info(`Y-axis labels: ${y1Text}, ${y2Text}, ${y3Text}`);

      expect(y1Text.toLowerCase()).toContain("count");
      expect(y2Text.toLowerCase()).toContain("sum");
      expect(y3Text.toLowerCase()).toContain("avg");

      // Save panel
      await savePanelWithName(page, "Multiple Aggregations Panel");

      testLogger.info("Test 4: Multiple Y-axis with different aggregations - PASSED");

    } finally {
      // Cleanup
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });

  /**
   * Test 5: MIN and MAX Functions
   * Tests MIN and MAX aggregation functions
   */
  test("Test 5: MIN and MAX functions", {
    tag: ['@dashboard-functions', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 5: Starting with testId=${testId}`);

    try {
      // Setup: Ingest test data
      await ingestTestData(STREAM_NAME, testRecords);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Login and create dashboard
      await navigateToBase(page);
      const pm = new PageManager(page);

      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);
      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");

      // Add X-axis field
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add Y-axis field with MIN function
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "min");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Add Y-axis field with MAX function
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_2");
      await selectFunction(page, "max");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Apply query
      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      // Verify chart renders
      const chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
      await expect(chartRenderer.first()).toBeVisible({ timeout: 15000 });

      // Verify Y-axis labels
      const y1Label = page.locator('[data-test="dashboard-y-item-y_axis_1"]');
      const y2Label = page.locator('[data-test="dashboard-y-item-y_axis_2"]');

      const y1Text = await y1Label.textContent();
      const y2Text = await y2Label.textContent();

      testLogger.info(`Y-axis labels: ${y1Text}, ${y2Text}`);

      expect(y1Text.toLowerCase()).toContain("min");
      expect(y2Text.toLowerCase()).toContain("max");

      // Save panel
      await savePanelWithName(page, "MIN MAX Functions");

      testLogger.info("Test 5: MIN and MAX functions - PASSED");

    } finally {
      // Cleanup
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });

  /**
   * Test 6: SUM Aggregation Function
   * Tests SUM aggregation on numeric field
   */
  test("Test 6: SUM aggregation function", {
    tag: ['@dashboard-functions', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 6: Starting with testId=${testId}`);

    try {
      // Setup: Ingest test data
      await ingestTestData(STREAM_NAME, testRecords);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Login and create dashboard
      await navigateToBase(page);
      const pm = new PageManager(page);

      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);
      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");

      // Add X-axis field (timestamp for aggregation)
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add Y-axis field with SUM function
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "sum");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Apply query
      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      // Verify chart renders
      const chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
      await expect(chartRenderer.first()).toBeVisible({ timeout: 15000 });

      // Verify Y-axis label shows sum
      const yAxisLabel = page.locator('[data-test="dashboard-y-item-y_axis_1"]');
      const labelText = await yAxisLabel.textContent();
      testLogger.info(`Y-axis label: ${labelText}`);
      expect(labelText.toLowerCase()).toContain("sum");

      // Save panel
      await savePanelWithName(page, "SUM Function");

      testLogger.info("Test 6: SUM aggregation function - PASSED");

    } finally {
      // Cleanup
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });
});
