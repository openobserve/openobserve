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
} = require("../utils/enhanced-baseFixtures.js");
const { waitForDashboardPage } = require("../../pages/dashboardPages/dashCreation.js");
const PageManager = require("../../pages/page-manager");
const testLogger = require("../utils/test-logger.js");
const {
  getAuthHeaders,
  getOrgIdentifier,
  refreshCloudConfig,
} = require("../utils/cloud-auth.js");
const { waitForStreamData } = require("../utils/data-ingestion.js");

// Test data from external file
const testRecords = require("../../../test-data/dashboard-functions/test_records.json");

const generateDashboardName = (testId) => `FuncTest_${testId}`;
const generateStreamName = (testId) => `func_test_${testId}`;
const generateTestId = () => Math.random().toString(36).substring(2, 10);

/**
 * Navigate directly to dashboards page with org_identifier
 * This ensures the correct org context is set for all API calls
 */
const navigateToDashboards = async (page) => {
  const dashboardUrl = `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${getOrgIdentifier()}`;
  testLogger.info(`Navigating to dashboards page with org_identifier: ${dashboardUrl}`);
  await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
};

// Readiness gate for the freshly-ingested stream.
//
// This used to poll GET /streams with the same Basic credentials as the ingest
// call. On cloud that endpoint rejects the org passcode (401) even though the
// very same passcode ingests fine, so the poll silently burned its full timeout
// on every run and reported a bogus "stream not found" while the data was
// already queryable. page.request carries the logged-in browser context's
// cookies, and "is the data searchable" is the condition the panels actually
// need, so poll the search API through the page instead.
const verifyStreamExists = async (page, streamName, maxWaitMs = 60000) => {
  const ready = await waitForStreamData(page, streamName, 1, maxWaitMs);
  testLogger.info(
    ready
      ? `Stream ${streamName} verified as searchable`
      : `Stream ${streamName} not searchable after ${maxWaitMs}ms`
  );
  return ready;
};

const ingestTestData = async (page, streamName, data) => {
  // Resolve headers/org per attempt so a refreshed passcode is picked up on retry.
  const post = () =>
    fetch(
      `${process.env.INGESTION_URL}/api/${getOrgIdentifier()}/${streamName}/_json`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      }
    );

  const MAX_ATTEMPTS = 3;
  let fetchResponse;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    fetchResponse = await post();

    // The per-org cloud passcode can be rotated mid-run by another shard sharing the
    // org, so re-read it from the page's live session and retry rather than failing.
    if ((fetchResponse.status === 401 || fetchResponse.status === 403) && page) {
      testLogger.warn(
        `Ingestion returned ${fetchResponse.status} — refreshing cloud passcode and retrying`
      );
      if (await refreshCloudConfig(page)) continue;
    }

    if (fetchResponse.status >= 500 && attempt < MAX_ATTEMPTS) {
      testLogger.warn(
        `Ingestion returned ${fetchResponse.status} — retrying (attempt ${attempt}/${MAX_ATTEMPTS})`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      continue;
    }

    break;
  }

  if (!fetchResponse.ok) {
    const responseText = await fetchResponse.text().catch(() => "");
    throw new Error(`Ingestion failed: ${fetchResponse.status} - ${responseText}`);
  }

  testLogger.info("Verifying stream is indexed (polling up to 60 seconds)...");
  await verifyStreamExists(page, streamName, 60000);

  return fetchResponse.json();
};

const deleteStream = async (streamName) => {
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";
  try {
    await fetch(`${baseUrl}/api/${getOrgIdentifier()}/streams/${streamName}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    return true;
  } catch {
    return false;
  }
};

const deleteDashboardByName = async (dashboardName) => {
  const orgId = getOrgIdentifier();
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";
  try {
    const headers = getAuthHeaders();
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

  // Reload page to ensure fresh streams list is loaded after ingestion
  testLogger.info("Reloading page to refresh streams list...");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  await pm.dashboardCreate.addPanel();
}

async function selectStreamAndChartType(page, pm, streamName, chartType = "table") {
  await pm.chartTypeSelector.selectChartType(chartType);
  await pm.chartTypeSelector.selectStreamType("logs");
  await pm.chartTypeSelector.selectStream(streamName);
  await page.waitForTimeout(2000);
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

    // Navigate first: ingestion's 401 recovery re-reads the passcode through the
    // page's live session, which needs the page to already be on the app origin.
    await navigateToDashboards(page);

    // Setup: Ingest test data (includes stream verification polling)
    await ingestTestData(page, STREAM_NAME, testRecords);

    const pm = new PageManager(page);

    try {
      // === PANEL 1: COUNT Function ===
      testLogger.info("Panel 1: Testing COUNT function");
      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("user_name", "x");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await pm.dashboardPanelActions.verifyChartRenders(expect);
      const countRows = await pm.dashboardPanelActions.getTableRowCount();
      expect(countRows).toBeGreaterThan(0);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_1", "count", expect);
      testLogger.info(`Panel 1 COUNT: ${countRows} rows`);

      await pm.dashboardPanelActions.addPanelName("count-panel");
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: COUNT-DISTINCT Function ===
      testLogger.info("Panel 2: Testing COUNT-DISTINCT function");
      await pm.dashboardPanelActions.addNextPanel();

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("user_name", "y");

      // UI shows "Distinct" for COUNT-DISTINCT function; label displays as "count"
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "Distinct");

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_1", "count", expect);
      testLogger.info("Panel 2 COUNT-DISTINCT: Verified");

      await pm.dashboardPanelActions.addPanelName("count-distinct-panel");
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 3: AVG Function ===
      testLogger.info("Panel 3: Testing AVG function");
      await pm.dashboardPanelActions.addNextPanel();

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "avg");

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_1", "avg", expect);
      testLogger.info("Panel 3 AVG: Verified");

      await pm.dashboardPanelActions.addPanelName("avg-panel");
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 4: SUM Function ===
      testLogger.info("Panel 4: Testing SUM function");
      await pm.dashboardPanelActions.addNextPanel();

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("score", "y");

      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "sum");

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_1", "sum", expect);
      testLogger.info("Panel 4 SUM: Verified");

      await pm.dashboardPanelActions.addPanelName("sum-panel");
      await pm.dashboardPanelActions.savePanel();

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

    // Navigate first: ingestion's 401 recovery re-reads the passcode through the
    // page's live session, which needs the page to already be on the app origin.
    await navigateToDashboards(page);

    // Setup: Ingest test data (includes stream verification polling)
    await ingestTestData(page, STREAM_NAME, testRecords);

    const pm = new PageManager(page);

    try {
      // === PANEL 1: Multiple Y-axis with Different Aggregations ===
      testLogger.info("Panel 1: Testing Multiple Y-axis (COUNT, SUM, AVG)");
      await createDashboardAndAddFirstPanel(page, pm, DASHBOARD_NAME);

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add first Y-axis with COUNT
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("user_name", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      // Add second Y-axis with SUM
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_2", "sum");

      // Add third Y-axis with AVG
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_3", "avg");

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_1", "count", expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_2", "sum", expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_3", "avg", expect);
      testLogger.info("Panel 1 Multiple Y-axis: All 3 functions verified");

      await pm.dashboardPanelActions.addPanelName("multi-y-axis-panel");
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: MIN and MAX Functions ===
      testLogger.info("Panel 2: Testing MIN and MAX functions");
      await pm.dashboardPanelActions.addNextPanel();

      await selectStreamAndChartType(page, pm, STREAM_NAME, "table");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add Y-axis with MIN
      await pm.chartTypeSelector.removeField("y_axis_1", "y");
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "min");

      // Add Y-axis with MAX
      await pm.chartTypeSelector.searchAndAddField("score", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_2", "max");

      await pm.dashboardCreate.applyButton();
      await page.waitForTimeout(3000);

      await pm.dashboardPanelActions.verifyChartRenders(expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_1", "min", expect);
      await pm.chartTypeSelector.verifyYAxisLabel("y_axis_2", "max", expect);
      testLogger.info("Panel 2 MIN/MAX: Both functions verified");

      await pm.dashboardPanelActions.addPanelName("min-max-panel");
      await pm.dashboardPanelActions.savePanel();

      testLogger.info("Test 2: Advanced Aggregation Functions - ALL PANELS PASSED");

    } finally {
      await deleteDashboardByName(DASHBOARD_NAME);
      await deleteStream(STREAM_NAME);
    }
  });
});
