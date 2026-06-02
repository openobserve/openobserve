const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import logData from "../../fixtures/log.json";
import PageManager from "../../pages/page-manager";
import { waitForDateTimeButtonToBeEnabled } from "../../pages/dashboardPages/dashboard-time";
import DashboardPanelConfigs from "../../pages/dashboardPages/dashboard-panel-configs";

import { deleteDashboard } from "./utils/dashCreation.js";

//Dashboard name
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).slice(2, 11);

// Panel name
const panelName = "Panel_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

// Stream name used across tests
const STREAM_NAME = "e2e_automate";
// Add a global SQL query constant that can be reused across tests
const largeDatasetSqlQuery = `SELECT kubernetes_annotations_kubectl_kubernetes_io_default_container as "x_axis_1",
  count(kubernetes_container_hash) as "y_axis_1",
  count(kubernetes_container_name) as "y_axis_2",
  count(kubernetes_host) as "y_axis_3",
  count(kubernetes_labels_app_kubernetes_io_instance) as "y_axis_4",
  count(kubernetes_labels_app_kubernetes_io_name) as "y_axis_5",
  count(kubernetes_labels_app_kubernetes_io_version) as "y_axis_6",
  count(kubernetes_labels_operator_prometheus_io_name) as "y_axis_7",
  count(kubernetes_labels_prometheus) as "y_axis_8",
  kubernetes_labels_statefulset_kubernetes_io_pod_name as "breakdown_1"
  FROM "${STREAM_NAME}"
  WHERE kubernetes_namespace_name IS NOT NULL
  GROUP BY x_axis_1, breakdown_1`;

const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1"  FROM "${STREAM_NAME}"  GROUP BY x_axis_1 ORDER BY x_axis_1 ASC `;

const histogramQueryWithHaving = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1"  FROM "${STREAM_NAME}"  GROUP BY x_axis_1 HAVING y_axis_1 >= 1000 ORDER BY x_axis_1 ASC`;

// Query without aliases for testing error message
const queryWithoutAliases = `SELECT count(kubernetes_container_hash), count(kubernetes_container_name), count(kubernetes_host) FROM "${STREAM_NAME}" WHERE kubernetes_namespace_name IS NOT NULL GROUP BY kubernetes_annotations_kubectl_kubernetes_io_default_container`;

test.describe("logs testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"] ?? "default"}`;

    await page.goto(logsUrl);
    await page.waitForLoadState("networkidle", { timeout: 15000 });

    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    await pm.logsVisualise.logsApplyQueryButton();
  });

  test("should create logs when queries are ingested into the search field", {
    tag: ["@logs", "@visualize", "@P2", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.enableSQLMode();

    await pm.logsVisualise.logsSelectStream("e2e_automate");
    await pm.logsVisualise.setRelative("30", "m");
    await pm.logsVisualise.logsApplyQueryButton();

    // Verify query executed without errors by waiting for results to load
    await pm.logsVisualise.waitForLogsQueryToComplete();
    await pm.logsVisualise.verifyNoDashboardErrors();
    testLogger.info("Logs query executed successfully after ingestion");
  });

  test("should handle large datasets and complex SQL queries without showing an error on the chart", {
    tag: ["@logs", "@visualize", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openQueryEditor();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("30", "m");
    await pm.logsVisualise.logsApplyQueryButton();
    await pm.logsVisualise.openVisualiseTab();

    // Assert that no dashboard errors are displayed (uses real selector)
    await pm.logsVisualise.verifyNoDashboardErrors();
    testLogger.info("Large dataset query rendered without errors");
  });

  test("should redirect the correct chart type when added the aggregation query", {
    tag: ["@logs", "@visualize", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    await pm.logsVisualise.streamIndexList();

    // Verify table panel is visible with data
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);
    await pm.logsVisualise.verifyChartRenders(page);
    testLogger.info("Aggregation query correctly defaulted to table chart");
  });

  test("should not show dashboard errors when changing chart types with aggregation query", {
    tag: ["@logs", "@visualize", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    // Define chart types to test
    const chartTypes = ["table", "line", "bar", "area", "scatter", "pie"];

    // Test each chart type using page object methods
    for (const chartType of chartTypes) {
      await pm.logsVisualise.selectChartType(chartType);

      // Wait for chart to load
      await pm.logsVisualise.verifyChartRenders(page);

      // Check for dashboard errors
      const errorResult = await pm.logsVisualise.checkDashboardErrors(
        page,
        chartType
      );

      if (errorResult.hasErrors) {
        testLogger.error(`Dashboard errors found for ${chartType} chart`, { errors: errorResult.errors });
        expect(errorResult.errorTextCount).toBe(0);
        expect(errorResult.errorListCount).toBe(0);
      }

      // Verify the chart renders successfully
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);
      testLogger.info(`Chart type "${chartType}" rendered without errors`);
    }
  });

  test("should set line chart as default when using histogram query", {
    tag: ["@logs", "@visualize", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    // Verify line chart is selected as default for histogram queries
    await pm.logsVisualise.verifyChartTypeSelected(page, "line", true);

    // Verify table chart is NOT selected for histogram queries
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", false);

    // Verify chart canvas renders successfully
    await expect(pm.logsVisualise.getChartRendererCanvas().last()).toBeVisible();

    // Verify chart renders without errors
    const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
    expect(chartRendered).toBe(true);
    testLogger.info("Histogram query defaulted to line chart as expected");
  });

  test("Should display the correct query in the dashboard when saved from a Table chart.", {
    tag: ["@logs", "@visualize", "@dashboard", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.verifyChartRenders(page);

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    await pm.logsVisualise.verifyToastMessage("Panel added to dashboard");

    await pm.logsVisualise.openPanelQueryInspector(panelName);

    // Verify the executed query contains the expected SQL
    await pm.logsVisualise.verifyExecutedQueryContains(["e2e_automate", "x_axis_1"]);
    await pm.logsVisualise.closeQueryInspector();
    testLogger.info("Table chart query inspector verified");

    await pm.logsVisualise.clickDashboardBackBtn();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct query in the dashboard when saved from a Line chart.", {
    tag: ["@logs", "@visualize", "@dashboard", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    await pm.logsVisualise.verifyToastMessage("Panel added to dashboard");

    await pm.logsVisualise.openPanelQueryInspector(panelName);

    // Verify the executed query contains the expected SQL
    await pm.logsVisualise.verifyExecutedQueryContains(["histogram(_timestamp)", "e2e_automate"]);
    await pm.logsVisualise.closeQueryInspector();
    testLogger.info("Line chart query inspector verified");

    await pm.logsVisualise.clickDashboardBackBtn();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should save SELECT * query panel to dashboard successfully", {
    tag: ["@logs", "@visualize", "@dashboard", "@P1", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    const selectAllQuery = `SELECT * FROM "${STREAM_NAME}"`;

    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    // Run the query in visualize tab before saving to dashboard
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    await pm.logsVisualise.verifyToastMessage("Panel added to dashboard");

    // Verify the panel is visible on the dashboard
    const panelDropdown = page.locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`);
    await expect(panelDropdown).toBeVisible({ timeout: 20000 });
    testLogger.info("SELECT * panel saved to dashboard successfully");

    await pm.logsVisualise.clickDashboardBackBtn();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should show error message when using aggregation functions without aliases in SQL query", {
    tag: ["@logs", "@visualize", "@P2", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(queryWithoutAliases);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // Wait for error message to appear in toast
    await pm.logsVisualise.verifyToastMessage("Fields using aggregation functions must have aliases");
    testLogger.info("Alias error message displayed as expected");
  });

  test("should show quick mode toggle accessible in visualize tab", {
    tag: ["@logs", "@visualize", "@P2", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.logsSelectStream("e2e_automate");

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // Read the current quick mode state (varies by environment)
    const initialState = await pm.logsVisualise.getQuickModeToggleState();
    testLogger.info(`Quick mode initial state: ${initialState}`);

    // Verify we can read the state (boolean, not null/undefined)
    expect(typeof initialState).toBe("boolean");
    testLogger.info("Quick mode toggle is accessible in visualize tab");
  });

  test("should show connect null values toggle as true by default when visualizing histogram query with HAVING clause", {
    tag: ["@logs", "@visualize", "@P2", "@all"],
  }, async ({ page }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(histogramQueryWithHaving);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // Wait for chart to render
    await pm.logsVisualise.verifyChartRenders(page);

    // Open the config panel to access the connect null values toggle
    const panelConfigs = new DashboardPanelConfigs(page);
    await panelConfigs.openConfigPanel();

    // Verify connect null values toggle is true by default
    const connectNullState = await panelConfigs.verifyConnectNullValuesToggle(true);
    expect(connectNullState).toBe(true);

    // Additional assertion using page object locator
    const connectNullToggleBtn = pm.logsVisualise.getConnectNullValuesToggle();
    await expect(connectNullToggleBtn).toHaveAttribute("aria-checked", "true");
    testLogger.info("Connect null values toggle verified as true by default");
  });

});
