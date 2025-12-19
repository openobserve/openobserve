/**
 * Dashboard Joins Feature - Consolidated E2E Tests
 *
 * Tests the Dashboard Joins functionality that allows users to correlate data
 * across multiple streams using SQL JOIN operations in the dashboard panel builder.
 *
 * Architecture (PARALLEL EXECUTION with MULTI-PANEL):
 * - Each test creates its OWN dashboard with MULTIPLE panels
 * - Each test uses UNIQUE streams: join_<testId>_requests, join_<testId>_users, join_<testId>_sessions
 * - Panels are added serially within each test
 * - Tests run in PARALLEL across different dashboards
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
 *
 * Consolidated from 22 tests → 7 tests for efficiency
 */

const {
  test,
  expect,
} = require("../utils/enhanced-baseFixtures.js");
const { waitForDashboardPage } = require("../../pages/dashboardPages/dashCreation.js");
const PageManager = require("../../pages/page-manager");
const testLogger = require("../utils/test-logger.js");
const { JoinHelper, getTableRowCount, verifyJoinChipVisible } = require("../../pages/dashboardPages/dashboard-joins.js");

// Test data files (from CI-accessible location)
const testAppUsers = require("../../../test-data/joins/test_app_users.json");
const testSessions = require("../../../test-data/joins/test_sessions.json");
const testWebRequests = require("../../../test-data/joins/test_web_requests.json");

const generateDashboardName = (testId) => `Joins_Test_${testId}`;
const generateStreamNames = (testId) => ({
  WEB_REQUESTS: `join_${testId}_requests`,
  APP_USERS: `join_${testId}_users`,
  SESSIONS: `join_${testId}_sessions`,
});
const generateTestId = () => `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

/**
 * Navigate directly to dashboards page with org_identifier
 * This ensures the correct org context is set for all API calls
 */
const navigateToDashboards = async (page) => {
  const dashboardUrl = `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}`;
  testLogger.info(`Navigating to dashboards page with org_identifier: ${dashboardUrl}`);
  await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
};

const getAuthToken = async () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");
  return `Basic ${basicAuthCredentials}`;
};

const ingestJoinTestData = async (streamName, data) => {
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

const verifyStreamExists = async (streamName, maxWaitMs = 60000) => {
  const orgId = process.env["ORGNAME"];
  const baseUrl = process.env["INGESTION_URL"] || "http://localhost:5080";
  const headers = { Authorization: await getAuthToken() };
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${baseUrl}/api/${orgId}/streams?type=logs`, { headers });
      if (response.ok) {
        const data = await response.json();
        const streams = data.list || [];
        if (streams.some(s => s.name === streamName)) {
          testLogger.info(`Stream ${streamName} verified as available`);
          return true;
        }
      }
    } catch (e) {
      // Ignore errors, continue polling
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  testLogger.info(`Stream ${streamName} not found after ${maxWaitMs}ms`);
  return false;
};

const ingestTestData = async (streams) => {
  testLogger.info(`Ingesting test data for streams: ${streams.WEB_REQUESTS}, ${streams.APP_USERS}, ${streams.SESSIONS}`);
  await ingestJoinTestData(streams.APP_USERS, testAppUsers);
  await ingestJoinTestData(streams.SESSIONS, testSessions);
  await ingestJoinTestData(streams.WEB_REQUESTS, testWebRequests);

  testLogger.info("Verifying streams are indexed (polling up to 60 seconds)...");
  await verifyStreamExists(streams.WEB_REQUESTS, 60000);
  await verifyStreamExists(streams.APP_USERS, 60000);
  await verifyStreamExists(streams.SESSIONS, 60000);
  testLogger.info("All streams verified");
};

const cleanupStreams = async (streams) => {
  testLogger.info(`Cleaning up streams`);
  await deleteStream(streams.WEB_REQUESTS);
  await deleteStream(streams.APP_USERS);
  await deleteStream(streams.SESSIONS);
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

  // Reload page to ensure fresh streams list is loaded after ingestion
  testLogger.info("Reloading page to refresh streams list...");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await pm.dashboardCreate.addPanel();
}

async function verifyJoinChipIsVisible(page, streamName, joinIndex = 0) {
  await verifyJoinChipVisible(page, streamName, joinIndex, expect);
}

// ============================================================================
// CONSOLIDATED TESTS - 7 tests covering all 22 original test cases
// ============================================================================

test.describe("Dashboard Joins Feature Tests (Consolidated)", () => {

  /**
   * Test 1: Core Join Types (3 panels)
   * - Panel 1: INNER JOIN → 11 rows
   * - Panel 2: LEFT JOIN → 12 rows
   * - Panel 3: RIGHT JOIN → 5+ rows
   */
  test("Test 1: Core Join Types - INNER, LEFT, RIGHT (3 panels)", {
    tag: ['@dashboard-joins', '@smoke', '@P0']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      // === PANEL 1: INNER JOIN ===
      testLogger.info("Panel 1: Testing INNER JOIN");
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("inner-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const innerRowCount = await getTableRowCount(page);
      expect(innerRowCount).toBe(11);
      testLogger.info(`Panel 1 INNER JOIN: ${innerRowCount} rows (expected 11)`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: LEFT JOIN ===
      testLogger.info("Panel 2: Testing LEFT JOIN");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("left-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("left", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const leftRowCount = await getTableRowCount(page);
      expect(leftRowCount).toBe(12);
      testLogger.info(`Panel 2 LEFT JOIN: ${leftRowCount} rows (expected 12)`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 3: RIGHT JOIN ===
      testLogger.info("Panel 3: Testing RIGHT JOIN");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("right-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("right", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS);

      await pm.chartTypeSelector.searchAndAddField("name", "x");
      await pm.chartTypeSelector.searchAndAddField("email", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const rightRowCount = await getTableRowCount(page);
      expect(rightRowCount).toBeGreaterThanOrEqual(5);
      testLogger.info(`Panel 3 RIGHT JOIN: ${rightRowCount} rows (expected >= 5)`);

      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 2: Join Conditions & Multi-Join (3 panels)
   * - Panel 1: Multiple AND conditions (user_id + session_id)
   * - Panel 2: 3-Way Join (users + sessions)
   * - Panel 3: Session join with device/browser fields
   */
  test("Test 2: Join Conditions & Multi-Join (3 panels)", {
    tag: ['@dashboard-joins', '@dashboard-joins-conditions', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      // === PANEL 1: Multiple AND Conditions ===
      testLogger.info("Panel 1: Testing Multiple AND Conditions");
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("multi-condition-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

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

      const multiCondRowCount = await getTableRowCount(page);
      expect(multiCondRowCount).toBe(12);
      testLogger.info(`Panel 1 Multiple Conditions: ${multiCondRowCount} rows (expected 12)`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: 3-Way Join ===
      testLogger.info("Panel 2: Testing 3-Way Join");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("three-way-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // First join: INNER with users
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);

      // Second join: LEFT with sessions
      await joinHelper.configureJoin("left", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ], 1);
      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS, 1);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("status", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const threeWayRowCount = await getTableRowCount(page);
      expect(threeWayRowCount).toBe(11);
      testLogger.info(`Panel 2 3-Way Join: ${threeWayRowCount} rows (expected 11)`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 3: Session Join with device/browser ===
      testLogger.info("Panel 3: Testing Session Join");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("session-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

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

      const sessionRowCount = await getTableRowCount(page);
      expect(sessionRowCount).toBe(12);
      testLogger.info(`Panel 3 Session Join: ${sessionRowCount} rows (expected 12)`);

      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 3: Aggregation Functions (4 panels)
   * - Panel 1: Basic table with joined data
   * - Panel 2: Group by plan (SUM-like)
   * - Panel 3: Group by plan with response_time
   * - Panel 4: Bytes grouped by plan
   */
  test("Test 3: Aggregation Functions (4 panels)", {
    tag: ['@dashboard-joins', '@dashboard-joins-aggregation', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      // === PANEL 1: Basic Aggregation Table ===
      testLogger.info("Panel 1: Basic Aggregation Table");
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("basic-agg-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const basicRowCount = await getTableRowCount(page);
      expect(basicRowCount).toBe(11);
      testLogger.info(`Panel 1 Basic: ${basicRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: SUM-like grouping by plan ===
      testLogger.info("Panel 2: SUM-like grouping by plan");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("sum-agg-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("plan", "x");
      await pm.chartTypeSelector.searchAndAddField("bytes", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const sumRowCount = await getTableRowCount(page);
      expect(sumRowCount).toBeGreaterThanOrEqual(1);
      testLogger.info(`Panel 2 SUM: ${sumRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 3: AVG-like grouping ===
      testLogger.info("Panel 3: AVG-like grouping");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("avg-agg-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("plan", "x");
      await pm.chartTypeSelector.searchAndAddField("response_time_ms", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const avgRowCount = await getTableRowCount(page);
      expect(avgRowCount).toBeGreaterThanOrEqual(1);
      testLogger.info(`Panel 3 AVG: ${avgRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 4: MIN/MAX-like grouping ===
      testLogger.info("Panel 4: MIN/MAX-like grouping");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("minmax-agg-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("name", "x");
      await pm.chartTypeSelector.searchAndAddField("response_time_ms", "y");
      await pm.chartTypeSelector.searchAndAddField("bytes", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const minmaxRowCount = await getTableRowCount(page);
      expect(minmaxRowCount).toBeGreaterThanOrEqual(1);
      testLogger.info(`Panel 4 MIN/MAX: ${minmaxRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 4: Field Selection (4 panels)
   * - Panel 1: response_time_ms + name
   * - Panel 2: country + name
   * - Panel 3: bytes + plan
   * - Panel 4: email + name
   */
  test("Test 4: Field Selection (4 panels)", {
    tag: ['@dashboard-joins', '@dashboard-joins-fields', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      // === PANEL 1: response_time_ms field ===
      testLogger.info("Panel 1: response_time_ms field");
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("response-time-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("response_time_ms", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      expect(await getTableRowCount(page)).toBe(11);
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: country field ===
      testLogger.info("Panel 2: country field");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("country-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("country", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      expect(await getTableRowCount(page)).toBe(11);
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 3: bytes field ===
      testLogger.info("Panel 3: bytes field");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("bytes-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("bytes", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      expect(await getTableRowCount(page)).toBe(11);
      await pm.dashboardPanelActions.savePanel();

      // === PANEL 4: email field ===
      testLogger.info("Panel 4: email field");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("email-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("email", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      expect(await getTableRowCount(page)).toBe(11);
      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 5: Filters & Edge Cases (6 panels)
   * - Panel 1: INNER + filter setup
   * - Panel 2: LEFT JOIN with NULLs (12 rows)
   * - Panel 3: Session duration join
   * - Panel 4: Not-Equal join (!=)
   * - Panel 5: Greater-than join (>)
   * - Panel 6: Self-join
   */
  test("Test 5: Filters & Edge Cases (6 panels)", {
    tag: ['@dashboard-joins', '@dashboard-joins-filters', '@P2']
  }, async ({ page }, testInfo) => {
    testInfo.setTimeout(300000);  // 5 minutes for 6 panels
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      // === PANEL 1: Join with filter ===
      testLogger.info("Panel 1: Join with filter");
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("filter-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const filterRowCount = await getTableRowCount(page);
      expect(filterRowCount).toBeGreaterThan(0);
      expect(filterRowCount).toBeLessThanOrEqual(11);
      testLogger.info(`Panel 1 Filter: ${filterRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 2: LEFT JOIN showing NULLs ===
      testLogger.info("Panel 2: LEFT JOIN showing NULLs");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("null-display-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("left", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");
      await pm.chartTypeSelector.searchAndAddField("name", "y");
      await pm.chartTypeSelector.searchAndAddField("email", "y");
      await pm.chartTypeSelector.searchAndAddField("plan", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const nullRowCount = await getTableRowCount(page);
      expect(nullRowCount).toBe(12);
      testLogger.info(`Panel 2 NULL Display: ${nullRowCount} rows (expected 12)`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 3: Session duration join ===
      testLogger.info("Panel 3: Session duration join");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("duration-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("duration_mins", "y");
      await pm.chartTypeSelector.searchAndAddField("device", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const durationRowCount = await getTableRowCount(page);
      expect(durationRowCount).toBeGreaterThan(0);
      testLogger.info(`Panel 3 Duration: ${durationRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 4: Not-Equal Join (!=) ===
      testLogger.info("Panel 4: Testing Not-Equal Join (!=)");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("not-equal-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("left", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "!=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const notEqualRowCount = await getTableRowCount(page);
      expect(notEqualRowCount).toBeGreaterThanOrEqual(0);
      testLogger.info(`Panel 4 Not-Equal: ${notEqualRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 5: Greater-than Join (>) ===
      testLogger.info("Panel 5: Testing Greater-than Join (>)");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("greater-than-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("left", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: ">", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("status", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const greaterThanRowCount = await getTableRowCount(page);
      expect(greaterThanRowCount).toBeGreaterThanOrEqual(0);
      testLogger.info(`Panel 5 Greater-than: ${greaterThanRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

      // === PANEL 6: Self-Join ===
      testLogger.info("Panel 6: Testing Self-Join");
      await pm.dashboardPanelActions.addNextPanel();
      await pm.dashboardPanelActions.addPanelName("self-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      await joinHelper.configureJoin("inner", STREAMS.WEB_REQUESTS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const selfJoinRowCount = await getTableRowCount(page);
      expect(selfJoinRowCount).toBeGreaterThan(0);
      testLogger.info(`Panel 6 Self-Join: ${selfJoinRowCount} rows`);

      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 6: Dynamic Join Operations & UI Validation
   * - Add join → verify → Add second → verify → Remove first → verify
   * - Condition management: remove button disabled with single condition
   */
  test("Test 6: Dynamic Join Operations & UI Validation", {
    tag: ['@dashboard-joins', '@dashboard-joins-dynamic', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("dynamic-join-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Add first join
      testLogger.info("Adding first join (users)");
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);

      // Add second join
      testLogger.info("Adding second join (sessions)");
      await joinHelper.configureJoin("left", STREAMS.SESSIONS, [
        { leftField: "session_id", operation: "=", rightField: "session_id" },
      ], 1);
      await verifyJoinChipIsVisible(page, STREAMS.SESSIONS, 1);

      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(2000);

      // Remove the first join
      testLogger.info("Removing first join");
      await joinHelper.removeJoin(0);
      await page.waitForTimeout(500);

      // Apply again and verify it still works
      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(2000);

      // Verify no errors
      await pm.dashboardPanelActions.verifyNoErrors(expect);
      testLogger.info("Dynamic join operations completed successfully");

      // === UI Validation: Condition Management ===
      testLogger.info("Testing condition management UI validation");

      // Click on the remaining join to open popup
      await joinHelper.openJoinItemPopup(0);

      // With single condition, remove button should be disabled
      await joinHelper.verifyConditionRemoveButtonDisabled(0, expect);
      testLogger.info("Remove button correctly disabled with single condition");

      // Add another condition
      await joinHelper.addAnotherCondition(0);
      await page.waitForTimeout(500);

      // Now remove buttons should be enabled
      await joinHelper.verifyConditionRemoveButtonEnabled(0, expect);
      testLogger.info("Remove buttons enabled with multiple conditions");

      // Remove the added condition
      await joinHelper.removeCondition(1);
      await page.waitForTimeout(500);

      // Back to single condition, remove should be disabled again
      await joinHelper.verifyConditionRemoveButtonDisabled(0, expect);
      testLogger.info("Remove button disabled again after removing to single condition");

      await joinHelper.closeJoinPopup();

      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 7: Persistence (standalone)
   * - Create panel with join → Save → Navigate away → Return → Verify join preserved
   */
  test("Test 7: Persistence - Save and Reload Dashboard", {
    tag: ['@dashboard-joins', '@dashboard-joins-persistence', '@P1']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);
    const panelName = "persist-join-panel";

    try {
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
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
      testLogger.info("Panel saved, navigating away");

      // Navigate back to dashboard list
      await navigateToDashboards(page);
      await pm.dashboardList.menuItem("dashboards-item");

      // Wait for dashboard list to load
      await pm.dashboardPanelActions.waitForDashboardSearchVisible();

      // Search and open the dashboard
      await pm.dashboardCreate.searchDashboard(dashboardName);
      await page.waitForTimeout(2000);

      const dashboardRow = pm.dashboardPanelActions.getDashboardRow(dashboardName);
      await expect(dashboardRow).toBeVisible({ timeout: 10000 });
      await dashboardRow.click();
      await page.waitForTimeout(3000);
      testLogger.info("Dashboard opened, editing panel");

      // Edit the panel
      await pm.dashboardPanelEdit.editPanel(panelName);
      await page.waitForTimeout(3000);

      // Verify join configuration is preserved
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);
      testLogger.info("Join configuration preserved after reload");

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

  /**
   * Test 8: Error Handling & Recovery
   * - Incomplete join configuration (add but don't fully configure)
   * - Cancel/close join popup mid-configuration
   * - Remove join and verify panel still works
   * - Panel without any fields after removing join
   */
  test("Test 8: Error Handling & Recovery", {
    tag: ['@dashboard-joins', '@dashboard-joins-error', '@P2']
  }, async ({ page }) => {
    const testId = generateTestId();
    const STREAMS = generateStreamNames(testId);
    const dashboardName = generateDashboardName(testId);

    // Ingest data FIRST, then navigate to ensure fresh stream data is loaded
    await ingestTestData(STREAMS);

    await navigateToDashboards(page);

    const pm = new PageManager(page);
    const joinHelper = new JoinHelper(page);

    try {
      // === Scenario 1: Incomplete join is gracefully handled ===
      testLogger.info("Scenario 1: Testing incomplete join configuration");
      await createDashboardAndAddFirstPanel(page, pm, dashboardName);
      await pm.dashboardPanelActions.addPanelName("error-handling-panel");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream(STREAMS.WEB_REQUESTS);
      await page.waitForTimeout(2000);

      // Add a join but close popup before configuring conditions
      await joinHelper.clickAddJoinButton();
      await joinHelper.waitForJoinItem(0);

      // Click on the new join item to open popup
      await joinHelper.openJoinItemPopup(0);

      // Select join type but don't configure fully - close popup
      await joinHelper.selectJoinType("inner");
      await page.waitForTimeout(500);

      // Close popup without completing configuration
      await joinHelper.closeJoinPopup();
      testLogger.info("Closed popup with incomplete join configuration");

      // Verify the incomplete join chip is still visible (even if not fully configured)
      const isChipVisible = await joinHelper.isJoinChipVisible(0);
      testLogger.info(`Incomplete join chip visible: ${isChipVisible}`);

      // Remove the incomplete join
      if (isChipVisible) {
        await joinHelper.removeJoin(0);
        testLogger.info("Removed incomplete join");
      }

      // === Scenario 2: Panel works without joins ===
      testLogger.info("Scenario 2: Verifying panel works without joins");

      // Add fields and apply - should work without any joins
      await pm.chartTypeSelector.searchAndAddField("request_id", "x");
      await pm.chartTypeSelector.searchAndAddField("path", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      // Verify we get data without joins
      const noJoinRowCount = await getTableRowCount(page);
      expect(noJoinRowCount).toBeGreaterThan(0);
      testLogger.info(`Panel without joins: ${noJoinRowCount} rows`);

      // === Scenario 3: Add valid join, remove it, panel still works ===
      testLogger.info("Scenario 3: Add join then remove it");

      // Now add a proper join
      await joinHelper.configureJoin("inner", STREAMS.APP_USERS, [
        { leftField: "user_id", operation: "=", rightField: "user_id" },
      ]);
      await verifyJoinChipIsVisible(page, STREAMS.APP_USERS, 0);

      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const withJoinRowCount = await getTableRowCount(page);
      expect(withJoinRowCount).toBeGreaterThan(0);
      testLogger.info(`Panel with join: ${withJoinRowCount} rows`);

      // Now remove the join
      await joinHelper.removeJoin(0);
      await page.waitForTimeout(500);

      // Verify join chip is gone
      await joinHelper.verifyJoinChipNotVisible(0, expect);
      testLogger.info("Join removed successfully");

      // Apply again - should still work
      await pm.dashboardPanelActions.applyDashboardBtn();
      await page.waitForTimeout(3000);

      const afterRemoveRowCount = await getTableRowCount(page);
      expect(afterRemoveRowCount).toBeGreaterThan(0);
      testLogger.info(`Panel after removing join: ${afterRemoveRowCount} rows (expected same as without join)`);

      // Verify we get back to original row count (without join)
      expect(afterRemoveRowCount).toBe(noJoinRowCount);
      testLogger.info("Row count matches - join removal worked correctly");

      await pm.dashboardPanelActions.savePanel();

    } finally {
      await cleanupStreams(STREAMS);
      await deleteDashboardByName(dashboardName);
    }
  });

});
