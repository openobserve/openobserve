const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import logData from "../../fixtures/log.json";
import PageManager from "../../pages/page-manager";
const testLogger = require("../utils/test-logger.js");

// Stream name used across tests
const STREAM_NAME = "e2e_automate";

// SQL queries with NOT IN filter
const queryWithNotIn = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM_NAME}" WHERE kubernetes_container_name NOT IN ('abc') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

const queryWithNotInMultipleValues = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM_NAME}" WHERE kubernetes_container_name NOT IN ('abc', 'def', 'ghi') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// SQL queries with Starts With (LIKE 'value%') filter
const queryWithStartsWith = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM_NAME}" WHERE kubernetes_container_name LIKE 'ziox%' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// SQL queries with Ends With (LIKE '%value') filter
const queryWithEndsWith = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM_NAME}" WHERE kubernetes_container_name LIKE '%ziox' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// Combined filters query
const queryWithCombinedFilters = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM_NAME}" WHERE kubernetes_container_name NOT IN ('abc') AND kubernetes_host LIKE 'node%' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

test.describe("Visualization filter parsing testcases", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);

    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState("networkidle").catch(() => {});

    const pm = new PageManager(page);
    await pm.logsVisualise.logsApplyQueryButton();

    testLogger.info("Test setup completed");
  });

  test(
    "should render visualization correctly with NOT IN filter in SQL query",
    {
      tag: ["@logsVisualize", "@filterParsing", "@smoke", "@P0"],
    },
    async ({ page }) => {
      testLogger.info("Testing NOT IN filter parsing on logs-to-visualize toggle");
      const pm = new PageManager(page);

      // Open logs and fill query with NOT IN filter
      await pm.logsVisualise.openLogs();
      await pm.logsVisualise.fillLogsQueryEditor(queryWithNotIn);
      await pm.logsVisualise.setRelative("45", "m");
      await pm.logsVisualise.logsApplyQueryButton();

      // Toggle to visualize tab
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart renders without errors
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);

      // Verify no dashboard errors are displayed
      const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Line");
      expect(errorResult.hasErrors).toBe(false);

      testLogger.info("NOT IN filter test completed successfully");
    }
  );

  test(
    "should render visualization correctly with Starts With (LIKE value%) filter in SQL query",
    {
      tag: ["@logsVisualize", "@filterParsing", "@smoke", "@P0"],
    },
    async ({ page }) => {
      testLogger.info("Testing Starts With filter parsing on logs-to-visualize toggle");
      const pm = new PageManager(page);

      // Open logs and fill query with Starts With filter
      await pm.logsVisualise.openLogs();
      await pm.logsVisualise.fillLogsQueryEditor(queryWithStartsWith);
       await pm.logsVisualise.setRelative("45", "m");
      await pm.logsVisualise.logsApplyQueryButton();

      // Toggle to visualize tab
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart renders without errors
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);

      // Verify no dashboard errors are displayed
      const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Line");
      expect(errorResult.hasErrors).toBe(false);

      testLogger.info("Starts With filter test completed successfully");
    }
  );

  test(
    "should render visualization correctly with Ends With (LIKE %value) filter in SQL query",
    {
      tag: ["@logsVisualize", "@filterParsing", "@smoke", "@P0"],
    },
    async ({ page }) => {
      testLogger.info("Testing Ends With filter parsing on logs-to-visualize toggle");
      const pm = new PageManager(page);

      // Open logs and fill query with Ends With filter
      await pm.logsVisualise.openLogs();
      await pm.logsVisualise.fillLogsQueryEditor(queryWithEndsWith);
       await pm.logsVisualise.setRelative("45", "m");
      await pm.logsVisualise.logsApplyQueryButton();

      // Toggle to visualize tab
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart renders without errors
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);

      // Verify no dashboard errors are displayed
      const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Line");
      expect(errorResult.hasErrors).toBe(false);

      testLogger.info("Ends With filter test completed successfully");
    }
  );

  test(
    "should preserve NOT IN filter with multiple values on visualize toggle",
    {
      tag: ["@logsVisualize", "@filterParsing", "@functional", "@P1"],
    },
    async ({ page }) => {
      testLogger.info("Testing NOT IN with multiple values on logs-to-visualize toggle");
      const pm = new PageManager(page);

      // Open logs and fill query with NOT IN filter having multiple values
      await pm.logsVisualise.openLogs();
      await pm.logsVisualise.fillLogsQueryEditor(queryWithNotInMultipleValues);
       await pm.logsVisualise.setRelative("45", "m");
      await pm.logsVisualise.logsApplyQueryButton();

      // Toggle to visualize tab
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart renders without errors
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);

      // Verify no dashboard errors
      const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Line");
      expect(errorResult.hasErrors).toBe(false);

      // Verify line chart is selected as default for histogram queries
      await pm.logsVisualise.verifyChartTypeSelected(page, "line", true);

      testLogger.info("NOT IN with multiple values test completed successfully");
    }
  );

  test(
    "should render visualization correctly with combined NOT IN and Starts With filters",
    {
      tag: ["@logsVisualize", "@filterParsing", "@functional", "@P1"],
    },
    async ({ page }) => {
      testLogger.info("Testing combined filters on logs-to-visualize toggle");
      const pm = new PageManager(page);

      // Open logs and fill query with combined filters
      await pm.logsVisualise.openLogs();
      await pm.logsVisualise.fillLogsQueryEditor(queryWithCombinedFilters);
       await pm.logsVisualise.setRelative("45", "m");
      await pm.logsVisualise.logsApplyQueryButton();

      // Toggle to visualize tab
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart renders without errors
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);

      // Verify no dashboard errors
      const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Line");
      expect(errorResult.hasErrors).toBe(false);

      testLogger.info("Combined filters test completed successfully");
    }
  );

  test(
    "should preserve NOT IN filter when switching between logs and visualize tabs",
    {
      tag: ["@logsVisualize", "@filterParsing", "@regression", "@P2"],
    },
    async ({ page }) => {
      testLogger.info("Testing round-trip filter preservation: logs -> visualize -> logs -> visualize");
      const pm = new PageManager(page);

      // Open logs and fill query with NOT IN filter
      await pm.logsVisualise.openLogs();
      await pm.logsVisualise.fillLogsQueryEditor(queryWithNotIn);
       await pm.logsVisualise.setRelative("45", "m");
      await pm.logsVisualise.logsApplyQueryButton();

      // First toggle: logs -> visualize
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart renders on first toggle
      const firstRender = await pm.logsVisualise.verifyChartRenders(page);
      expect(firstRender).toBe(true);

      // Toggle back to logs
      await pm.logsVisualise.backToLogs();
      await page.waitForTimeout(1000);

      // Second toggle: logs -> visualize again
      await pm.logsVisualise.openVisualiseTab();

      // Verify chart still renders correctly on second toggle
      const secondRender = await pm.logsVisualise.verifyChartRenders(page);
      expect(secondRender).toBe(true);

      // Verify no dashboard errors after round-trip
      const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Line");
      expect(errorResult.hasErrors).toBe(false);

      testLogger.info("Round-trip filter preservation test completed successfully");
    }
  );
});
