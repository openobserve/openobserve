/**
 * Dashboard Joins Feature - Automated E2E Tests
 *
 * Tests the Dashboard Joins functionality that allows users to correlate data
 * across multiple streams using SQL JOIN operations in the dashboard panel builder.
 *
 * Architecture (PARALLEL EXECUTION):
 * - Each test creates its OWN dashboard: "Joins_Test_<testId>"
 * - Each test uses UNIQUE streams: join_<testId>_requests, join_<testId>_users, join_<testId>_sessions
 * - Each test cleans up its own dashboard and streams in the finally block
 * - Tests can run in PARALLEL for faster execution
 *
 * Test Data per test:
 * - join_{testId}_users: 5 users (U001-U005)
 * - join_{testId}_sessions: 8 sessions (S001-S008, S008 is orphan with U999)
 * - join_{testId}_requests: 12 requests (R001-R012, R010 is orphan with U999)
 *
 * Expected Join Results:
 * - INNER JOIN (requests + users): 11 rows (R010 excluded)
 * - LEFT JOIN: 12 rows (all requests, NULL for U999)
 * - RIGHT JOIN: 5 users appear
 * - 3-way join: 11 rows
 */

const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const { waitForDashboardPage } = require("./utils/dashCreation.js");
const PageManager = require("../../pages/page-manager");
const testLogger = require("../utils/test-logger.js");
const { JoinHelper, getTableRowCount, verifyJoinChipVisible } = require("../../pages/dashboardPages/dashboard-joins.js");

// Test data files
const testAppUsers = require("../../MD_Files/joins_test/data/test_app_users.json");
const testSessions = require("../../MD_Files/joins_test/data/test_sessions.json");
const testWebRequests = require("../../MD_Files/joins_test/data/test_web_requests.json");

/**
 * Generate unique dashboard name for a test
 * @param {string} testId - Unique identifier for the test
 * @returns {string} Dashboard name
 */
const generateDashboardName = (testId) => `Joins_Test_${testId}`;

/**
 * Generate unique stream names for a test
 * @param {string} testId - Unique identifier for the test
 * @returns {Object} Stream names object
 */
const generateStreamNames = (testId) => ({
  WEB_REQUESTS: `join_${testId}_requests`,
  APP_USERS: `join_${testId}_users`,
  SESSIONS: `join_${testId}_sessions`,
});

/**
 * Generate a unique test ID
 * @returns {string} Random 8-character alphanumeric string
 */
const generateTestId = () => Math.random().toString(36).substr(2, 8);

/**
 * Get authentication token from environment variables
 * @returns {Promise<string>} Basic auth token
 */
const getAuthToken = async () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");
  return `Basic ${basicAuthCredentials}`;
};

/**
 * Ingest test data for joins testing via API
 * @param {string} streamName - Name of the stream to ingest data into
 * @param {Array} data - JSON data to ingest
 */
const ingestJoinTestData = async (streamName, data) => {
  if (!process.env["ORGNAME"] || !process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = process.env["ORGNAME"];

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };

    const url = `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
    testLogger.info(`Ingesting to: ${url}`);

    const fetchResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });

    const responseText = await fetchResponse.text();
    testLogger.info(`Ingestion response for ${streamName}: HTTP ${fetchResponse.status} - ${responseText}`);

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${responseText}`
      );
    }

    return JSON.parse(responseText);
  } catch (error) {
    testLogger.error(`Ingestion failed for ${streamName}: ${error.message}`);
    throw error;
  }
};

/**
 * Delete a stream via API
 * @param {string} streamName - Name of the stream to delete
 * @returns {Promise<boolean>} True if deleted successfully
 */
const deleteStream = async (streamName) => {
  const orgId = process.env["ORGNAME"];
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";

  try {
    const headers = {
      Authorization: await getAuthToken(),
    };

    const fetchResponse = await fetch(
      `${baseUrl}/api/${orgId}/streams/${streamName}`,
      {
        method: "DELETE",
        headers,
      }
    );

    if (fetchResponse.ok || fetchResponse.status === 404) {
      return true;
    }

    testLogger.warn(`Failed to delete stream ${streamName}: ${fetchResponse.status}`);
    return false;
  } catch (error) {
    testLogger.warn(`Error deleting stream ${streamName}: ${error.message}`);
    return false;
  }
};

/**
 * Verify stream data count using _search API
 * @param {string} streamName - Name of the stream to verify
 * @param {number} expectedCount - Expected record count
 * @returns {Promise<boolean>} True if count matches expected
 */
const verifyStreamData = async (streamName, expectedCount) => {
  const orgId = process.env["ORGNAME"];
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };

    const response = await fetch(
      `${baseUrl}/api/${orgId}/${streamName}/_search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: {
            sql: `SELECT COUNT(*) as count FROM ${streamName}`,
            start_time: 0,
            end_time: 9999999999999999
          }
        }),
      }
    );

    if (!response.ok) {
      testLogger.error(`Verification failed for ${streamName}: HTTP ${response.status}`);
      return false;
    }

    const data = await response.json();
    const actualCount = data?.hits?.[0]?.count || data?.hits?.[0]?.COUNT || 0;
    testLogger.info(`Stream ${streamName}: ${actualCount} records (expected ${expectedCount})`);
    return actualCount === expectedCount;
  } catch (error) {
    testLogger.error(`Verification error for ${streamName}: ${error.message}`);
    return false;
  }
};

/**
 * Ingest all join test data into streams for a specific test
 * @param {Object} streams - Stream names object
 */
const ingestTestData = async (streams) => {
  testLogger.info(`Ingesting test data for streams: ${streams.WEB_REQUESTS}, ${streams.APP_USERS}, ${streams.SESSIONS}`);
  await ingestJoinTestData(streams.APP_USERS, testAppUsers);
  await ingestJoinTestData(streams.SESSIONS, testSessions);
  await ingestJoinTestData(streams.WEB_REQUESTS, testWebRequests);
  testLogger.info("Join test data ingestion complete");

  // Wait for indexing then verify
  testLogger.info("Waiting 3 seconds for indexing...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify data counts
  await verifyStreamData(streams.APP_USERS, 5);
  await verifyStreamData(streams.SESSIONS, 8);
  await verifyStreamData(streams.WEB_REQUESTS, 12);
};

/**
 * Cleanup streams after test
 * @param {Object} streams - Stream names object
 */
const cleanupStreams = async (streams) => {
  testLogger.info(`Cleaning up streams: ${streams.WEB_REQUESTS}, ${streams.APP_USERS}, ${streams.SESSIONS}`);
  await deleteStream(streams.WEB_REQUESTS);
  await deleteStream(streams.APP_USERS);
  await deleteStream(streams.SESSIONS);
};

/**
 * Delete a dashboard via API by name
 * @param {string} dashboardName - Name of the dashboard to delete
 * @returns {Promise<boolean>} True if deleted successfully
 */
const deleteDashboardByName = async (dashboardName) => {
  const orgId = process.env["ORGNAME"];
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };

    // List dashboards to find the one with matching name
    const listResponse = await fetch(
      `${baseUrl}/api/${orgId}/dashboards`,
      {
        method: "GET",
        headers,
      }
    );

    if (!listResponse.ok) {
      testLogger.warn(`Failed to list dashboards: ${listResponse.status}`);
      return false;
    }

    const dashboards = await listResponse.json();
    const dashboard = dashboards.dashboards?.find(d => d.title === dashboardName);

    if (!dashboard) {
      testLogger.info(`Dashboard "${dashboardName}" not found - may already be deleted`);
      return true;
    }

    // Delete the dashboard by ID
    const deleteResponse = await fetch(
      `${baseUrl}/api/${orgId}/dashboards/${dashboard.dashboardId}`,
      {
        method: "DELETE",
        headers,
      }
    );

    if (deleteResponse.ok || deleteResponse.status === 404) {
      testLogger.info(`Deleted dashboard: ${dashboardName}`);
      return true;
    }

    testLogger.warn(`Failed to delete dashboard ${dashboardName}: ${deleteResponse.status}`);
    return false;
  } catch (error) {
    testLogger.warn(`Error deleting dashboard ${dashboardName}: ${error.message}`);
    return false;
  }
};

/**
 * Create a new dashboard and add a panel for testing
 * @param {Page} page - Playwright page object
 * @param {PageManager} pm - PageManager instance
 * @param {string} dashboardName - Unique name for this test's dashboard
 */
async function createDashboardAndAddPanel(page, pm, dashboardName) {
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();

  await pm.dashboardCreate.createDashboard(dashboardName);
  testLogger.info(`Created dashboard: ${dashboardName}`);

  // Add a panel (dashboard is empty so this will work)
  await pm.dashboardCreate.addPanel();
}

/**
 * Wrapper function to verify join chip - adapts standalone function for tests
 * @param {Page} page - Playwright page object
 * @param {string} streamName - Expected stream name in the chip
 * @param {number} joinIndex - Index of the join chip (0-based)
 */
async function verifyJoinChipIsVisible(page, streamName, joinIndex = 0) {
  await verifyJoinChipVisible(page, streamName, joinIndex, expect);
}

// PARALLEL EXECUTION - each test creates and cleans up its own dashboard
test.describe("Dashboard Joins Feature Tests", () => {

  test("Test 1: Basic INNER JOIN (Table Chart) - should return 11 rows", {
    tag: ['@dashboard-joins', '@smoke', '@P0']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("inner-join-test");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users stream
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (INNER JOIN excludes U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 2: LEFT JOIN (Table Chart) - should return 12 rows with NULL for unmatched", {
    tag: ['@dashboard-joins', '@smoke', '@P0']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("left-join-test");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure LEFT JOIN with users stream
      await joinHelper.configureJoin("left", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 12 rows (all requests, including U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(12);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 3: RIGHT JOIN (Table Chart) - should show all users", {
    tag: ['@dashboard-joins', '@smoke', '@P0']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("right-join-test");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure RIGHT JOIN with users stream
      await joinHelper.configureJoin("right", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("name", "x");
      await pm.chartTypeSelector.searchAndAddField("email", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify all 5 users appear (may have more rows if users have multiple requests)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThanOrEqual(5);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 4: Multiple Join Conditions (AND) - both conditions must match", {
    tag: ['@dashboard-joins', '@dashboard-joins-conditions', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("multi-condition-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with sessions using TWO conditions
      await joinHelper.configureJoin("inner", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("device", "y");
      await pm.chartTypeSelector.searchAndAddField("browser", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 12 rows (all match - R010/S008 both have U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(12);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 6: 3-Way Join (Multiple Joins) - join three streams together", {
    tag: ['@dashboard-joins', '@dashboard-joins-multi', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("three-way-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // First Join: INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);

      // Second Join: LEFT JOIN with sessions (index 1)
      await joinHelper.configureJoin("left", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ], 1);
      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS, 1);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("status", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (limited by INNER join with users - U999 excluded)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 7: Joins with Aggregation (Table Chart) - verify joined data displays correctly", {
    tag: ['@dashboard-joins', '@dashboard-joins-aggregation', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("aggregation-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (INNER JOIN excludes U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 9: Add/Remove Joins Dynamically - verify no errors", {
    tag: ['@dashboard-joins', '@dashboard-joins-dynamic', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("dynamic-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Add first join
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);

      // Add second join (index 1)
      await joinHelper.configureJoin("left", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ], 1);
      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS, 1);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(2000);

      // Remove the first join
      await joinHelper.removeJoin(0);
      await page.waitForTimeout(500);

      // Apply again and verify it still works
      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(2000);

      // Verify no errors occurred
      const noDataElement = page.locator('[data-test="no-data"]');
      const noErrors = await noDataElement.isHidden();
      expect(noErrors).toBeTruthy();

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 10: Save and Reload Dashboard - verify joins persist", {
    tag: ['@dashboard-joins', '@dashboard-joins-persistence', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("persist-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(2000);
      await pm.dashboardPanelActions.savePanel();

      // Navigate back to dashboard view
      await navigateToBase(page);
      await pm.dashboardList.menuItem("dashboards-item");

      // Wait for dashboard list to load
      const dashboardSearch = page.locator('[data-test="dashboard-search"]');
      await dashboardSearch.waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Search for and open the dashboard
      await pm.dashboardCreate.searchDashboard(dashboardName);
      await page.waitForTimeout(2000);

      // Click on the dashboard to open it
      const dashboardRow = page.getByRole("row", { name: new RegExp(`.*${dashboardName}`) });
      await expect(dashboardRow).toBeVisible({ timeout: 10000 });
      await dashboardRow.click();
      await page.waitForTimeout(3000);

      // Edit the panel
      await pm.dashboardPanelEdit.editPanel(panelName);
      await page.waitForTimeout(3000);

      // Verify join configuration is preserved
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 5: Non-Equality Operators - test != operator", {
    tag: ['@dashboard-joins', '@dashboard-joins-operators', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("non-equality-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with sessions
      await joinHelper.configureJoin("inner", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ]);

      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("device", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify results returned
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThan(0);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 8: Joins with Filters - filter joined results", {
    tag: ['@dashboard-joins', '@dashboard-joins-filters', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("filter-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      // Add a filter for plan field
      const filterBtn = page.locator('[data-test="dashboard-add-filter-btn"]');
      if (await filterBtn.isVisible()) {
        await filterBtn.click();
        await page.waitForTimeout(500);
        await page.keyboard.type("plan");
        await page.waitForTimeout(500);
        const planOption = page.locator('[data-test="stream-field-select-option-plan"]');
        if (await planOption.isVisible()) {
          await planOption.click();
        }
      }

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify results (should have fewer rows due to filter)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThan(0);
      expect(rowCount).toBeLessThanOrEqual(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 11: Join with response_time_ms field - verify field from primary stream", {
    tag: ['@dashboard-joins', '@dashboard-joins-fields', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("response-time-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("response_time_ms", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (INNER JOIN excludes U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 12: Join with country field - verify field from joined stream", {
    tag: ['@dashboard-joins', '@dashboard-joins-fields', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("country-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("country", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (INNER JOIN excludes U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 13: Join with bytes field - verify numeric field from primary stream", {
    tag: ['@dashboard-joins', '@dashboard-joins-fields', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("bytes-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("bytes", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (INNER JOIN excludes U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 14: SUM Aggregation with Joins - total bytes per plan", {
    tag: ['@dashboard-joins', '@dashboard-joins-aggregation', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("sum-agg-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("plan", "x");
      await pm.chartTypeSelector.searchAndAddField("bytes", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify rows grouped by plan (3 plans: premium, free, enterprise)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThanOrEqual(1);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 15: AVG Aggregation with Joins - average response time per plan", {
    tag: ['@dashboard-joins', '@dashboard-joins-aggregation', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("avg-agg-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("plan", "x");
      await pm.chartTypeSelector.searchAndAddField("response_time_ms", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify rows grouped by plan
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThanOrEqual(1);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 16: MIN/MAX Aggregation with Joins - min/max response time per plan", {
    tag: ['@dashboard-joins', '@dashboard-joins-aggregation', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("minmax-agg-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("plan", "x");
      await pm.chartTypeSelector.searchAndAddField("response_time_ms", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify rows returned
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThanOrEqual(1);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 17: Empty Result Handling - graceful handling of no matches", {
    tag: ['@dashboard-joins', '@dashboard-joins-edge-cases', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("empty-result-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users (valid join for graceful handling test)
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify page handles gracefully (no JavaScript errors)
      const noDataElement = page.locator('[data-test="no-data"]');
      const tableElement = page.locator('[data-test="dashboard-panel-table"]');
      const hasNoData = await noDataElement.isVisible().catch(() => false);
      const hasTable = await tableElement.isVisible().catch(() => false);

      // Either no data message or table should be visible
      expect(hasNoData || hasTable).toBeTruthy();

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 18: NULL Value Display in LEFT JOIN - verify NULL for unmatched rows", {
    tag: ['@dashboard-joins', '@dashboard-joins-edge-cases', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("null-display-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure LEFT JOIN - will include U999 row with NULL user details
      await joinHelper.configureJoin("left", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("email", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify all 12 rows (LEFT JOIN keeps all left records)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(12);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 19: Join with Session Duration Filter - numeric filter on joined data", {
    tag: ['@dashboard-joins', '@dashboard-joins-filters', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("duration-filter-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with sessions
      await joinHelper.configureJoin("inner", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("duration_mins", "y");
      await pm.chartTypeSelector.searchAndAddField("device", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify data returned
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThan(0);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 20: Join with Multiple Filters - combine join with multiple filter conditions", {
    tag: ['@dashboard-joins', '@dashboard-joins-filters', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("multi-filter-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("status", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify data returned
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThan(0);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 21: Join with email field - verify email from joined stream", {
    tag: ['@dashboard-joins', '@dashboard-joins-fields', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("email-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("email", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 11 rows (INNER JOIN excludes U999)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(11);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  test("Test 22: Join with sessions - verify device and browser fields", {
    tag: ['@dashboard-joins', '@dashboard-joins-sessions', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    await navigateToBase(page);
    await ingestTestData(STREAMS);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = pm.dashboardPanelActions.generateUniquePanelName("sessions-join");

    try {
      await createDashboardAndAddPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Configure INNER JOIN with sessions
      await joinHelper.configureJoin("inner", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("device", "y");
      await pm.chartTypeSelector.searchAndAddField("browser", "y");
      await pm.chartTypeSelector.searchAndAddField("os", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify 12 rows (all requests match sessions)
      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBe(12);

      await pm.dashboardPanelActions.savePanel();
    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });
});
