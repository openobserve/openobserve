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

import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
const testLogger = require("../utils/test-logger.js");

//Dashboard name
const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

// Panel name
const panelName = "Panel_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });
const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page

    .locator('[data-test="log-search-index-list-select-stream"]')

    .fill(stream);
  await page.locator("div.q-item").getByText(`${stream}`).first().click();
};

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

    // await selectStreamAndStreamTypeForLogs(page, logData.Stream);
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
    await pm.logsVisualise.setRelative("4", "d");
    await pm.logsVisualise.logsApplyQueryButton();
  });

  test.skip("should make the data disappear on the visualization page after a page refresh and navigate to the logs page", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("6", "w");

    //open the visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // // Add a field to the Y-axis
    // await page
    //   .locator('[data-test="index-field-search-input"]')
    //   .fill("kubernetes_container_hash");

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
    //   )
    //   .waitFor({ state: "visible" });

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]'
    //   )
    //   .click();
    // await page.locator('[data-test="index-field-search-input"]').fill("");
    // await page
    //   .locator('[data-test="index-field-search-input"]')
    //   .fill("kubernetes_container_name");

    // // Add a field to the breakdown
    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
    //   )
    //   .waitFor({ state: "visible" });

    // await page
    //   .locator(
    //     '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
    //   )
    //   .click();
    // await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Reload the page
    await page.reload();
    // Verify the field is empty
    await expect(page.locator(".view-line").first()).toBeEmpty();
  });

  test.skip("Ensure that switching between logs to visualize and back again results in the dropdown appearing blank, and the row is correctly handled.", async ({
    page,
  }) => {
    // Instantiate PageManager with the current page
    const pm = new PageManager(page);

    // Open the logs page and set relative time
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    // Apply query and switch to the visualise tab
    // await pm.logsVisualise.logsApplyQueryButton();
    await pm.logsVisualise.openVisualiseTab();

    // Switch back to logs and again to visualise
    await pm.logsVisualise.backToLogs();
    await pm.logsVisualise.openVisualiseTab();

    // Open the dropdown to check its state
    await page
      .locator('[data-test="dashboard-field-list-collapsed-icon"]')
      .click();

    await page.locator('[data-test="index-dropdown-stream"]').click();
    let previousCount = -1;
    let currentCount = 0;
    const maxRetries = 10;

    for (let i = 0; i < maxRetries; i++) {
      const options = await page.getByRole("option");
      currentCount = await options.count();

      if (currentCount > 0 && currentCount === previousCount) {
        break; // Options loaded and stable
      }

      previousCount = currentCount;
      await page.waitForTimeout(300); // Small delay before checking again
    }

    expect(currentCount).toBeGreaterThan(0);
  });

  test.skip("Should redirect to the table chart in visualization when the query includes more than two fields on the X-axis.", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    // const logsVisualise = new LogsVisualise(page);

    // Step 1: Open Logs page and query editor
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openQueryEditor();

    const queryEditor = page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .locator(".monaco-editor");
    await expect(queryEditor).toBeVisible();

    // Step 2: Fill and apply the initial query
    await queryEditor.fill(initialQuery.trim());
    await pm.logsVisualise.setRelative("1", "m");
    await pm.logsVisualise.logsApplyQueryButton();
    await page.waitForTimeout(3000); // Optional: Replace with proper wait if possible

    // Step 3: Open the Visualization tab
    await pm.logsVisualise.openVisualiseTab();
    await expect(
      page.locator('[data-test="selected-chart-table-item"]').locator("..")
    ).toHaveClass(/bg-grey-3|5/); // matches light (3) or dark (5) theme
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

    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.logsApplyQueryButton();
    await pm.logsVisualise.openVisualiseTab();

    // Check for any error messages or indicators
    const errorMessage = page.locator('[data-test="error-message"]');
    const errorCount = await errorMessage.count();

    // Assert that no error messages are displayed
    await expect(errorCount).toBe(0); // Fail the test if any error messages are present
  });
  test("Stream should be correct on visualize page after switching between logs and visualize", async ({
    page,
  }) => {
    // Extract stream name from the SQL query dynamically
    const streamNameMatch = largeDatasetSqlQuery.match(/FROM\s+"([^"]+)"/);
    const expectedStreamName = streamNameMatch
      ? streamNameMatch[1]
      : STREAM_NAME;

    const pm = new PageManager(page);

    // Step 1: Open Logs page and query editor
    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("6", "w");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // Wait for the stream dropdown to be populated
    await pm.logsVisualise.streamIndexList();

    // Get stream value using multiple selector strategies
    const getStreamValue = async () => {
      const selectors = [
        () =>
          page
            .locator('[data-test="index-dropdown-stream"]')
            .getAttribute("value"),
        () =>
          page
            .locator('.q-field__native input[aria-label="Stream"]')
            .getAttribute("value"),
        () => page.locator('[data-test="index-dropdown-stream"]').inputValue(),
        () => page.locator('input[aria-label="Stream"]').getAttribute("value"),
      ];

      for (const selector of selectors) {
        try {
          const value = await selector();
          if (value) return value;
        } catch (error) {
          // Continue to next selector
        }
      }
      return null;
    };

    const streamValue = await getStreamValue();

    // Assert that the stream value matches the expected stream name from the query
    expect(streamValue).toBe(expectedStreamName);
    expect(streamValue).toBeTruthy();

    // Assert that the stream value is specifically "e2e_automate"
    expect(streamValue).toBe("e2e_automate");
  });

  test("should redirect the correct chart type when added the aggregation query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(largeDatasetSqlQuery);

    await pm.logsVisualise.setRelative("6", "w");

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

    await pm.logsVisualise.setRelative("6", "w");

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
      await page.locator(chartType.selector).click();
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

    await pm.logsVisualise.setRelative("6", "w");

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

    await pm.logsVisualise.setRelative("6", "w");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.verifyChartRenders(page);

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    const successMessage = page.getByText("Panel added to dashboard");
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await pm.logsVisualise.waitForQueryInspector(page);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT kubernetes_annotations_kubectl_kubernetes_io_default_container as "x_axis_1", count(kubernetes_container_hash) as "y_axis_1", count(kubernetes_container_name) as "y_axis_2", count(kubernetes_host) as "y_axis_3", count(kubernetes_labels_app_kubernetes_io_instance) as "y_axis_4", count(kubernetes_labels_app_kubernetes_io_name) as "y_axis_5", count(kubernetes_labels_app_kubernetes_io_version) as "y_axis_6", count(kubernetes_labels_operator_prometheus_io_name) as "y_axis_7", count(kubernetes_labels_prometheus) as "y_axis_8", kubernetes_labels_statefulset_kubernetes_io_pod_name as "breakdown_1" FROM "e2e_automate" WHERE kubernetes_namespace_name IS NOT NULL GROUP BY x_axis_1, breakdown_1',
        })
        .first()
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("should display the correct query in the dashboard when saved from a Line chart.", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    await pm.logsVisualise.setRelative("6", "w");

    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    await pm.logsVisualise.runQueryAndWaitForCompletion();

    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    const successMessage = page.getByText("Panel added to dashboard");
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await pm.logsVisualise.waitForQueryInspector(page);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        })
        .first()
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();

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

    await pm.logsVisualise.setRelative("6", "w");

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
    const successMessage = page.getByText("Panel added to dashboard");
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    // Open Query Inspector from the panel actions
    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-query-inspector-panel"]').click();

    await pm.logsVisualise.waitForQueryInspector(page);

    await expect(
      page
        .getByRole("cell", {
          name: 'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "e2e_automate" GROUP BY zo_sql_key ORDER BY zo_sql_key DESC',
        })
        .first()
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

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
    await pm.logsVisualise.setRelative("6", "w");

    // Step 4: Apply the query
    await pm.logsVisualise.logsApplyQueryButton();

    // Step 5: Open the visualize tab
    await pm.logsVisualise.openVisualiseTab();

    // Step 6: Wait for error message to appear
    const errorMessage = page.getByText(
      "Fields using aggregation functions must have aliases"
    );

    // Wait for the error message to appear on the page
    await errorMessage.waitFor({ state: "visible", timeout: 10000 });

    // Step 7: Check for the specific error message using getByText
    // Verify the error message is displayed
    await expect(errorMessage.first()).toBeVisible();
  });
  test("should show quick mode as true when toggling to visualize tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();

    await pm.logsVisualise.logsSelectStream("e2e_automate");

    await waitForDateTimeButtonToBeEnabled(page);

    await pm.logsVisualise.setRelative("6", "w");

    // Step 4: Apply the query
    await pm.logsVisualise.logsApplyQueryButton();

    // Step 5: Open the visualize tab
    await pm.logsVisualise.openVisualiseTab();

    // Step 7: Verify quick mode toggle is true
    const quickModeState = await pm.logsVisualise.verifyQuickModeToggle(false);
    expect(quickModeState).toBe(false);

    // Additional assertion using Playwright's expect for the toggle state
    const quickModeToggle = page.locator(
      '[data-test="logs-search-bar-quick-mode-toggle-btn"]'
    );
    await expect(quickModeToggle).toHaveAttribute("aria-checked", "false");
  });
 test("should apply override config after running histogram query", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    // Open logs and prepare histogram query
    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.openQueryEditor();
    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);
    await pm.logsVisualise.setRelative("6", "w");
    await pm.logsVisualise.logsApplyQueryButton();

    // Go to visualize and wait for chart to render
    await pm.logsVisualise.openVisualiseTab();

    await pm.chartTypeSelector.selectChartType("table");

    await pm.logsVisualise.verifyChartRenders(page);

    // Open panel configs and configure override
    const panelConfigs = new DashboardPanelConfigs(page);
    await panelConfigs.openConfigPanel();
    await page.waitForTimeout(2000);
    await panelConfigs.scrollDownSidebarUntilOverrideVisible();

    await panelConfigs.configureOverride({
      columnName: "x_axis_1",
      typeName: "Unique Value Color",
      enableTypeCheckbox: true,
    });
    
    // Re-run the query to apply override effect and wait for rendering
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Assert that at least one table cell has a background color applied
    const coloredCells = page.locator(
      '[data-test="dashboard-panel-table"] tbody .q-td[style*="background-color"]'
    );
    await expect(coloredCells.first()).toBeVisible();
    const coloredCount = await coloredCells.count();
    testLogger.error(`[TEST] Colored cells detected: ${coloredCount}`);
    expect(coloredCount).toBeGreaterThan(0);

    // Capture and log the inline style(s) applied to colored cells
    const coloredStyles = await coloredCells.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("style") || "")
    );
    testLogger.error("[TEST] Colored cell inline styles:", coloredStyles);

     await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Wait for and assert the success message
    const successMessage = page.getByText("Panel added to dashboard");
    await expect(successMessage).toBeVisible({ timeout: 10000 });

      // Assert that at least one table cell has a background color applied
    const coloredCellsonPanel = page.locator(
      '[data-test="dashboard-panel-table"] tbody .q-td[style*="background-color"]'
    );
    await expect(coloredCellsonPanel.first()).toBeVisible();
    const coloredCountOnPanel = await coloredCellsonPanel.count();
    testLogger.error(`[TEST] Colored cells detected: ${coloredCountOnPanel}`);
    expect(coloredCountOnPanel).toBeGreaterThan(0);

    // Capture and log the inline style(s) applied to colored cells
    const coloredStylesOnPanel = await coloredCellsonPanel.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("style") || "")
    );
    testLogger.error("[TEST] Colored cell inline styles:", coloredStylesOnPanel    );

    // delete the dashboard

    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
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
    await pm.logsVisualise.setRelative("6", "w");

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
    const connectNullToggle = page.locator(
      '[data-test="dashboard-config-connect-null-values"]'
    );
    await expect(connectNullToggle).toHaveAttribute("aria-checked", "true");
  });

});
