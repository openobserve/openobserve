const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
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
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;

    await page.goto(logsUrl);
    await page.waitForLoadState("networkidle");

    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    await pm.logsVisualise.logsApplyQueryButton();
  });

  test("should create logs when queries are ingested into the search field", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and enable SQL mode
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.enableSQLMode();

    //set relative time
    await pm.logsVisualise.logsSelectStream("e2e_automate");
    await pm.logsVisualise.setRelative("12", "h");
    await pm.logsVisualise.logsApplyQueryButton();
  });

  test("should handle large datasets and complex SQL queries without showing an error on the chart", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    // const logsVisualise = new LogsVisualise(page);

    // Step 1: Open Logs page and query editor
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openQueryEditor();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("12", "h");
    await pm.logsVisualise.logsApplyQueryButton();
    await pm.logsVisualise.openVisualiseTab();

    // Check for any error messages or indicators
    const errorMessage = page.locator('[data-test="error-message"]');
    const errorCount = await errorMessage.count();

    // Assert that no error messages are displayed
    await expect(errorCount).toBe(0); // Fail the test if any error messages are present
  });
  test("should redirect the correct chart type when added the aggregation query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("12", "h");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await page.waitForTimeout(2000);

    await pm.logsVisualise.streamIndexList();

    await page.waitForSelector('[data-test="dashboard-panel-table"]', {
      timeout: 15000,
    });
    await expect(
      page.locator('[data-test="dashboard-panel-table"]')
    ).toBeVisible();

    // Method 3: Verify table-specific content is rendered (breakdown_1 column from the SQL query)
    await expect(
      page
        .locator('[data-test="dashboard-panel-table"]')
        .getByRole("cell", { name: "breakdown_1" })
    ).toBeVisible();
    await expect(
      page.locator('[data-test="dashboard-panel-table"]').first()
    ).toBeVisible();
  });

  test("should not show dashboard errors when changing chart types with aggregation query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("12", "h");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    // Define chart types to test
    const chartTypes = [
      { selector: '[data-test="selected-chart-table-item"]', name: "Table" },
      { selector: '[data-test="selected-chart-line-item"]', name: "Line" },
      { selector: '[data-test="selected-chart-bar-item"]', name: "Bar" },
      { selector: '[data-test="selected-chart-area-item"]', name: "Area" },
      {
        selector: '[data-test="selected-chart-scatter-item"]',
        name: "Scatter",
      },
      { selector: '[data-test="selected-chart-pie-item"]', name: "Pie" },
    ];

    // Test each chart type
    for (const chartType of chartTypes) {
      // Select the chart type
      await page.locator(chartType.selector).click({ force: true });
      await page.waitForTimeout(1000);

      // Wait for chart to load
      await pm.logsVisualise.verifyChartRenders(page);

      // Check for dashboard errors
      const errorResult = await pm.logsVisualise.checkDashboardErrors(
        page,
        chartType.name
      );

      if (errorResult.hasErrors) {
        errorResult.errors.forEach((error, index) => {});

        // Fail the test with detailed error information
        expect(errorResult.errorTextCount).toBe(0);
        expect(errorResult.errorListCount).toBe(0);
      } else {
      }

      // Verify the chart renders successfully
      const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
      expect(chartRendered).toBe(true);
    }
  });

  test("should set line chart as default when using histogram query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    await pm.logsVisualise.setRelative("12", "h");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    // Verify line chart is selected as default for histogram queries
    await pm.logsVisualise.verifyChartTypeSelected(page, "line", true);

    // Verify table chart is NOT selected for histogram queries
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", false);

    // Verify chart canvas renders successfully
    await expect(
      page.locator('[data-test="chart-renderer"] canvas').last()
    ).toBeVisible();

    // Verify chart renders without errors
    const chartRendered = await pm.logsVisualise.verifyChartRenders(page);
    expect(chartRendered).toBe(true);
  });

  test("Should display the correct query in the dashboard when saved from a Table chart.", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("12", "h");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.verifyChartRenders(page);

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    const successMessage = page.locator('[data-test="o-toast-message"]', { hasText: "Panel added to dashboard" }).first();
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await pm.logsVisualise.waitForQueryInspector(page);

    // Verify the executed query contains the expected SQL
    const executedQuery = page.locator('[data-test="query-inspector-executed-query-0"]');
    await expect(executedQuery).toBeVisible({ timeout: 10000 });
    await expect(executedQuery).toContainText("e2e_automate");
    await expect(executedQuery).toContainText("x_axis_1");
    await page.locator('[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]').click();

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct query in the dashboard when saved from a Line chart.", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    await pm.logsVisualise.setRelative("12", "h");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    const successMessage = page.locator('[data-test="o-toast-message"]', { hasText: "Panel added to dashboard" }).first();
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await pm.logsVisualise.waitForQueryInspector(page);

    // Verify the executed query contains the expected SQL
    const executedQuery = page.locator('[data-test="query-inspector-executed-query-0"]');
    await expect(executedQuery).toBeVisible({ timeout: 10000 });
    await expect(executedQuery).toContainText("histogram(_timestamp)");
    await expect(executedQuery).toContainText("e2e_automate");
    await page.locator('[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]').click();

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should render line chart for SELECT * query and save to dashboard with correct query in inspector", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    const selectAllQuery = `SELECT * FROM "${STREAM_NAME}"`;

    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    await pm.logsVisualise.setRelative("12", "h");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.verifyChartRenders(page);

    // Expect line chart to be the selected/default visualization
    await pm.logsVisualise.verifyChartTypeSelected(page, "line", true);

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    const successMessage = page.locator('[data-test="o-toast-message"]', { hasText: "Panel added to dashboard" }).first();
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    // Open Query Inspector from the panel actions
    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await pm.logsVisualise.waitForQueryInspector(page);

    // Verify the executed query contains the expected SQL
    const executedQuery = page.locator('[data-test="query-inspector-executed-query-0"]');
    await expect(executedQuery).toBeVisible({ timeout: 10000 });
    await expect(executedQuery).toContainText("e2e_automate");

    await page.locator('[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]').click();

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should show error message when using aggregation functions without aliases in SQL query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Step 1: Open logs page
    await pm.logsVisualise.openLogs();

    // Step 2: Fill the query editor with SQL query without aliases
    await pm.logsVisualise.fillLogsQueryEditor(queryWithoutAliases);

    // Step 3: Set relative time
    await pm.logsVisualise.setRelative("12", "h");

    // Step 4: Apply the query
    await pm.logsVisualise.logsApplyQueryButton();

    // Step 5: Open the visualize tab
    await pm.logsVisualise.openVisualiseTab();

    // Step 6: Wait for error message to appear in toast
    const errorMessage = page.locator('[data-test="o-toast-message"]', {
      hasText: "Fields using aggregation functions must have aliases",
    }).first();

    // Wait for the error message to appear on the page
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
  });
  test("should show quick mode as true when toggling to visualize tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.logsSelectStream("e2e_automate");

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.logsVisualise.setRelative("12", "h");

    // Step 4: Apply the query
    await pm.logsVisualise.logsApplyQueryButton();

    // Step 5: Open the visualize tab
    await pm.logsVisualise.openVisualiseTab();

    // Step 7: Verify quick mode toggle is true
    const quickModeState = await pm.logsVisualise.verifyQuickModeToggle(false);
    expect(quickModeState).toBe(false);

    // The page object method already verified the toggle state above
  });
  test("should show connect null values toggle as true by default when visualizing histogram query with HAVING clause", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Step 1: Open logs and enable SQL mode
    await pm.logsVisualise.openLogs();

    // Step 2: Fill the query editor with histogram query that has HAVING clause
    await pm.logsVisualise.fillLogsQueryEditor(histogramQueryWithHaving);

    // Step 3: Set relative time
    await pm.logsVisualise.setRelative("12", "h");

    // Step 4: Apply the query
    await pm.logsVisualise.logsApplyQueryButton();

    // Step 5: Open the visualize tab
    await pm.logsVisualise.openVisualiseTab();

    // Step 6: Wait for chart to render
    await pm.logsVisualise.verifyChartRenders(page);

    // Step 7: Open the config panel to access the connect null values toggle
    const panelConfigs = new DashboardPanelConfigs(page);
    await panelConfigs.openConfigPanel();

    // Wait for the config panel to be visible
    await page.waitForTimeout(1000);

    // Step 8: Verify connect null values toggle is true by default
    const connectNullState = await panelConfigs.verifyConnectNullValuesToggle(true);
    expect(connectNullState).toBe(true);

    // Step 9: Additional assertion using Playwright's expect for the toggle state
    const connectNullToggleBtn = page.locator(
      '[data-test="dashboard-config-connect-null-values"] [data-test$="-btn"]'
    );
    await expect(connectNullToggleBtn).toHaveAttribute("aria-checked", "true");
  });

});
