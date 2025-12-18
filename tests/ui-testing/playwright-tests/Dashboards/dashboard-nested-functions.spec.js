/**
 * Dashboard Functions E2E Tests (Consolidated)
 *
 * Tests the function capability in the Dashboard Panel Builder.
 * Consolidated from 6 individual tests into 2 multi-panel tests.
 *
 * Test 1: Basic Aggregation Functions (4 panels)
 *   - Panel 1: COUNT function
 *   - Panel 2: COUNT-DISTINCT function
 *   - Panel 3: AVG function
 *   - Panel 4: SUM function
 *
 * Test 2: Advanced Aggregation Functions (2 panels)
 *   - Panel 1: Multiple Y-axis (COUNT + SUM + AVG)
 *   - Panel 2: MIN + MAX functions
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

const generateDashboardName = (testId) => `FuncTest_${testId}`;
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

async function addNextPanel(page) {
  // Wait for the save to complete and panel editor to close
  await page.waitForTimeout(2000);

  // Wait for the add panel button to be visible with longer timeout
  const addPanelBtn = page.locator('[data-test="dashboard-panel-add"]');
  await addPanelBtn.waitFor({ state: "visible", timeout: 30000 });
  await addPanelBtn.click();
}

async function selectStreamAndChartType(page, pm, streamName, chartType = "table") {
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(streamName);

  // Wait for stream fields to load
  await page.waitForTimeout(2000);
}

async function savePanelWithName(page, panelName) {
  const panelTitleInput = page.locator('[data-test="dashboard-panel-name"]');
  await panelTitleInput.waitFor({ state: "visible", timeout: 10000 });
  await panelTitleInput.fill(panelName);

  const saveBtn = page.locator('[data-test="dashboard-panel-save"]');
  await saveBtn.waitFor({ state: "visible", timeout: 5000 });
  await saveBtn.click();

  await page.waitForTimeout(2000);
}

/**
 * Open the Y-axis function configuration popup
 */
async function openYAxisFunctionPopup(page, alias) {
  const yAxisItem = page.locator(`[data-test="dashboard-y-item-${alias}"]`);
  await yAxisItem.waitFor({ state: "visible", timeout: 10000 });
  await yAxisItem.click();

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

  await page.keyboard.type(functionName);
  await page.waitForTimeout(500);

  const option = page.getByRole("option", { name: functionName, exact: false }).first();
  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click();
  await page.waitForTimeout(500);
}

/**
 * Get table row count
 */
async function getTableRowCount(page) {
  await page.waitForTimeout(2000);
  const rows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
  return await rows.count();
}

/**
 * Verify Y-axis label contains expected function name
 */
async function verifyYAxisLabel(page, alias, expectedFunction) {
  const yAxisLabel = page.locator(`[data-test="dashboard-y-item-${alias}"]`);
  const labelText = await yAxisLabel.textContent();
  testLogger.info(`Y-axis ${alias} label: ${labelText}`);
  expect(labelText.toLowerCase()).toContain(expectedFunction.toLowerCase());
}

/**
 * Verify chart renders (table or chart-renderer)
 */
async function verifyChartRenders(page) {
  const chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
  await expect(chartRenderer.first()).toBeVisible({ timeout: 15000 });
}

// ============================================================================
// CONSOLIDATED TESTS - 2 tests covering all 6 original test cases
// ============================================================================

test.describe("Dashboard Functions", () => {
  test.describe.configure({ mode: "parallel" });

  /**
   * Test 1: Basic Aggregation Functions (4 panels)
   * - Panel 1: COUNT function
   * - Panel 2: COUNT-DISTINCT function
   * - Panel 3: AVG function
   * - Panel 4: SUM function
   */
  test("Test 1: Basic Aggregation Functions (4 panels)", {
    tag: ['@dashboard-functions', '@dashboard-functions-basic', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 1: Starting with testId=${testId}`);

    // Setup: Ingest test data
    await ingestTestData(STREAM_NAME, testRecords);
    await new Promise(resolve => setTimeout(resolve, 3000));

    await navigateToBase(page);
    const pm = new PageManager(page);

    try {
      // === PANEL 1: COUNT Function ===
      testLogger.info("Panel 1: Testing COUNT function");
      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("user_name", "x");
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "count");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await verifyChartRenders(page);
      const countRows = await getTableRowCount(page);
      expect(countRows).toBeGreaterThan(0);
      await verifyYAxisLabel(page, "y_axis_1", "count");
      testLogger.info(`Panel 1 COUNT: ${countRows} rows`);

      await savePanelWithName(page, "count-panel");

      // === PANEL 2: COUNT-DISTINCT Function ===
      testLogger.info("Panel 2: Testing COUNT-DISTINCT function");
      await addNextPanel(page);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("user_name", "y");

      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "Distinct");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await verifyChartRenders(page);
      await verifyYAxisLabel(page, "y_axis_1", "count");
      testLogger.info("Panel 2 COUNT-DISTINCT: Verified");

      await savePanelWithName(page, "count-distinct-panel");

      // === PANEL 3: AVG Function ===
      testLogger.info("Panel 3: Testing AVG function");
      await addNextPanel(page);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "avg");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await verifyChartRenders(page);
      await verifyYAxisLabel(page, "y_axis_1", "avg");
      testLogger.info("Panel 3 AVG: Verified");

      await savePanelWithName(page, "avg-panel");

      // === PANEL 4: SUM Function ===
      testLogger.info("Panel 4: Testing SUM function");
      await addNextPanel(page);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "sum");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await verifyChartRenders(page);
      await verifyYAxisLabel(page, "y_axis_1", "sum");
      testLogger.info("Panel 4 SUM: Verified");

      await savePanelWithName(page, "sum-panel");

      testLogger.info("Test 1: Basic Aggregation Functions - ALL PANELS PASSED");

    } finally {
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });

  /**
   * Test 2: Advanced Aggregation Functions (2 panels)
   * - Panel 1: Multiple Y-axis with different functions (COUNT, SUM, AVG)
   * - Panel 2: MIN and MAX functions
   */
  test("Test 2: Advanced Aggregation Functions (2 panels)", {
    tag: ['@dashboard-functions', '@dashboard-functions-advanced', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAM_NAME = generateStreamName(testId);
    const DASHBOARD_NAME = generateDashboardName(testId);

    testLogger.info(`Test 2: Starting with testId=${testId}`);

    // Setup: Ingest test data
    await ingestTestData(STREAM_NAME, testRecords);
    await new Promise(resolve => setTimeout(resolve, 3000));

    await navigateToBase(page);
    const pm = new PageManager(page);

    try {
      // === PANEL 1: Multiple Y-axis with Different Aggregations ===
      testLogger.info("Panel 1: Testing Multiple Y-axis (COUNT, SUM, AVG)");
      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add first Y-axis with COUNT
      await pm.chartTypeSelector.searchAndAddField("user_name", "y");
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "count");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Add second Y-axis with SUM
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_2");
      await selectFunction(page, "sum");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Add third Y-axis with AVG
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_3");
      await selectFunction(page, "avg");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await verifyChartRenders(page);
      await verifyYAxisLabel(page, "y_axis_1", "count");
      await verifyYAxisLabel(page, "y_axis_2", "sum");
      await verifyYAxisLabel(page, "y_axis_3", "avg");
      testLogger.info("Panel 1 Multiple Y-axis: All 3 functions verified");

      await savePanelWithName(page, "multi-y-axis-panel");

      // === PANEL 2: MIN and MAX Functions ===
      testLogger.info("Panel 2: Testing MIN and MAX functions");
      await addNextPanel(page);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add Y-axis with MIN
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_1");
      await selectFunction(page, "min");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Add Y-axis with MAX
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await openYAxisFunctionPopup(page, "y_axis_2");
      await selectFunction(page, "max");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await verifyChartRenders(page);
      await verifyYAxisLabel(page, "y_axis_1", "min");
      await verifyYAxisLabel(page, "y_axis_2", "max");
      testLogger.info("Panel 2 MIN/MAX: Both functions verified");

      await savePanelWithName(page, "min-max-panel");

      testLogger.info("Test 2: Advanced Aggregation Functions - ALL PANELS PASSED");

    } finally {
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });
});
