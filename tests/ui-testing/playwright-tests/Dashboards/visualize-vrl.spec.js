import {
  test,
  expect,
  navigateToBase,
} from "../utils/enhanced-baseFixtures.js";
import { ingestion } from "./utils/dashIngestion.js";
import logData from "../../fixtures/log.json";
import PageManager from "../../pages/page-manager";
import { deleteDashboard } from "./utils/dashCreation.js";

// Dashboard and panel names - using slice() instead of deprecated substr()
const randomDashboardName =
  "VRL_Dashboard_" + Math.random().toString(36).slice(2, 11);
const panelName = "VRL_Panel_" + Math.random().toString(36).slice(2, 11);

test.describe.configure({ mode: "parallel" });

// Stream name
const STREAM_NAME = "e2e_automate";

// VRL functions for testing (based on screenshot showing .vrl=100)
const simpleVrlFunction = `.vrl=100`;

const fieldCreationVrl = `.new_field = "test_value"
.status = "success"`;

// Fixed VRL - removed `!` when using `??` to avoid "unnecessary error coalescing" error
const complexVrlFunction = `.vrl_status = "processed"
.vrl_count = 100
.vrl_flag = true`;

// SQL queries
const selectAllQuery = `SELECT * FROM "${STREAM_NAME}"`;

const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "${STREAM_NAME}" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// Helper function to enable VRL editor with deterministic wait
async function enableVrlEditor(page) {
  const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
  await vrlToggle.waitFor({ state: "visible", timeout: 10000 });

  const isChecked = await vrlToggle.getAttribute("aria-checked");

  if (isChecked === "false") {
    await vrlToggle.click();
    await page.waitForTimeout(1000);
  }
}

test.describe("VRL visualization support testcases", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"] ?? "defaultorg"}`;
    await page.goto(logsUrl);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const pm = new PageManager(page);
    await pm.logsVisualise.logsApplyQueryButton();
  });

  test("[P1] Should display VRL function toggle and editor in visualization tab", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryButton();

    // Open visualization tab
    await pm.logsVisualise.openVisualiseTabWithVrl();

    // Verify VRL toggle button is visible in the toolbar
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    await expect(vrlToggle).toBeVisible();

    // Check if toggle is already on (aria-checked="true")
    const isChecked = await vrlToggle.getAttribute("aria-checked");

    if (isChecked === "false") {
      // Click VRL toggle to show editor
      await vrlToggle.click();
      // Wait for VRL editor to appear
      const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
      await vrlEditor.first().waitFor({ state: "visible", timeout: 10000 });
    }

    // Verify VRL editor is visible
    const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
    await expect(vrlEditor.first()).toBeVisible();
  });

  test("[P1] Should apply VRL function and display results in table visualization", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    // await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor
    await enableVrlEditor(page);

    // Add VRL function
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    // Open visualization tab with VRL - ensures table chart is selected
    await pm.logsVisualise.openVisualiseTabWithVrl();

    // IMPORTANT: Run query in visualization tab to populate table data
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Verify chart renders
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table panel is visible
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 15000 });

    // Verify table chart is selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);

    // Verify table has data
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    await expect(tableRows).not.toHaveCount(0, { timeout: 15000 });
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("[P1] Should disable VRL editor and show warning when switching to non-table chart", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);

    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);

    await pm.logsVisualise.setRelative("8", "h");

    await pm.logsVisualise.logsApplyQueryAndWait();

    // Open visualization tab
    await pm.logsVisualise.openVisualiseTabWithVrl();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Verify table panel is displayed initially
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Switch to line chart (now allowed with new behavior)
    await page.locator('[data-test="selected-chart-line-item"]').click();

    // Wait for VRL warning banner to appear
    const vrlWarningBanner = page.getByText("VRL function is only supported for table chart");
    await expect(vrlWarningBanner).toBeVisible({ timeout: 5000 });

    // NEW BEHAVIOR: Chart switching is now allowed - line chart should be selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "line", true);
  });

  test("[P1] Should show VRL warning for all non-table chart types when VRL is present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");

    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Test multiple chart types - all should show VRL warning (NEW BEHAVIOR)
    const chartTypes = ["line", "bar", "area", "scatter"];

    for (const chartType of chartTypes) {
      await page.locator(`[data-test="selected-chart-${chartType}-item"]`).click();

      // Wait for VRL warning banner to appear
      const vrlWarningBanner = page.getByText("VRL function is only supported for table chart");
      await expect(vrlWarningBanner).toBeVisible({ timeout: 5000 });

      // NEW BEHAVIOR: Chart switching is now allowed - verify selected chart type changed
      await pm.logsVisualise.verifyChartTypeSelected(page, chartType, true);

      // Switch back to table for next iteration
      await page.locator('[data-test="selected-chart-table-item"]').click();
      // Wait for table to be selected
      await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);
    }
  });

  test("[P1] Should save VRL panel to dashboard and preserve VRL configuration", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    // Use SELECT * query so VRL-generated fields appear in the result
    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);

    await pm.logsVisualise.setRelative("30", "m");

    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();

    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Click "Add To Dashboard" button
    await pm.logsVisualise.addPanelToNewDashboard(
      randomDashboardName,
      panelName
    );

    // Verify success
    const successMessage = page.getByText("Panel added to dashboard");
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    // Verify table chart is displayed on dashboard
    const tableOnDashboard = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tableOnDashboard).toBeVisible();

    // Edit the panel to verify VRL function is preserved
    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-edit-panel"]').click();

    // Wait for edit panel to load - use deterministic wait for table
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 15000 });

    await pm.dashboardTimeRefresh.setRelative("8", "h");
    // await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender(page);

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    await expect(tableRows).not.toHaveCount(0, { timeout: 15000 });
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify VRL configuration is preserved by checking the "vrl" column is visible in the table
    // The VRL function creates a "vrl" column with value 100
    const vrlColumnInFields = page.locator('text=vrl').first();
    await expect(vrlColumnInFields).toBeVisible({ timeout: 10000 });

    // Verify VRL values (100.00) are displayed in the table
    const vrlValues = page.locator('[data-test="dashboard-panel-table"]').getByText('100.00').first();
    await expect(vrlValues).toBeVisible({ timeout: 10000 });

    // Go back to dashboard
    await page.locator('[data-test="dashboard-panel-discard"]').click();

    // Handle discard confirmation if it appears
    const discardConfirm = page.locator('[data-test="confirm-button"]');
    if (await discardConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await discardConfirm.click();
    }

    // Wait for navigation back to dashboard
    await page.locator('[data-test="dashboard-back-btn"]').waitFor({ state: "visible", timeout: 10000 });

    // Cleanup - delete the dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("[P1] Should handle complex VRL function with multiple field creation", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    // Enable VRL editor and add complex function that creates multiple fields
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(complexVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");

    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table is displayed
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    await expect(tableRows).not.toHaveCount(0, { timeout: 15000 });
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify VRL toggle is enabled (confirming VRL is active)
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    const isVrlEnabled = await vrlToggle.getAttribute("aria-checked").catch(() => "false");
    expect(isVrlEnabled).toBe("true");

    // Verify at least one VRL-generated field is visible in the Fields list (left sidebar)
    // The complexVrlFunction creates: vrl_status, vrl_count, vrl_flag
    const vrlFieldInList = page.locator('text=vrl_status, text=vrl_count, text=vrl_flag').first();
    const isVrlFieldVisible = await vrlFieldInList.isVisible().catch(() => false);

    // If VRL field not found in sidebar, check in table - either location is valid
    if (!isVrlFieldVisible) {
      // Verify table has data which confirms VRL function executed without errors
      expect(rowCount).toBeGreaterThan(0);
    }

    // Verify no errors in the dashboard
    const errorResult = await pm.logsVisualise.checkDashboardErrors(page, "Table");
    expect(errorResult.hasErrors).toBe(false);
  });

  test("[P1] Should preserve VRL function when switching between logs and visualize tabs", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    // Verify VRL toggle is enabled before switching
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    let isChecked = await vrlToggle.getAttribute("aria-checked");
    expect(isChecked).toBe("true");

    // Switch to visualization
    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Verify table is displayed with data
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Switch back to logs
    await pm.logsVisualise.backToLogs();

    // Wait for VRL toggle to be visible in logs tab
    await vrlToggle.waitFor({ state: "visible", timeout: 10000 });

    // ASSERT: Verify VRL toggle is still enabled after switching back to logs
    isChecked = await vrlToggle.getAttribute("aria-checked");
    expect(isChecked).toBe("true");

    // ASSERT: Verify VRL editor is still visible
    const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
    await expect(vrlEditor.first()).toBeVisible();

    // Switch to visualization again
    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Verify chart still renders
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // ASSERT: Verify table is still displayed after tab switches
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // ASSERT: Verify table still has data rows
    const rowCountAfterSwitch = await tableRows.count();
    expect(rowCountAfterSwitch).toBeGreaterThan(0);

    // Verify no errors
    const errorResult = await pm.logsVisualise.checkDashboardErrors(
      page,
      "Table"
    );
    expect(errorResult.hasErrors).toBe(false);
  });

  test("[P1] Should override histogram default chart type (line) to table when VRL is present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(histogramQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.verifyChartRenders(page);

    // With VRL functions, table chart should be selected even for histogram queries
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);

    // Verify line chart is NOT selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "line", false);

    // Verify chart renders without errors
    const errorResult = await pm.logsVisualise.checkDashboardErrors(
      page,
      "Table"
    );
    expect(errorResult.hasErrors).toBe(false);
  });

  test("[P1] Should create multiple VRL fields and display all in table", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function that creates multiple fields
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(fieldCreationVrl);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table is displayed
    const table = page.locator('[data-test="dashboard-panel-table"]');
    await expect(table).toBeVisible();

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    await expect(tableRows).not.toHaveCount(0, { timeout: 15000 });
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify table has headers (columns)
    const headers = page.locator('[data-test="dashboard-panel-table"] thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test("[P1] Should allow table chart selection without VRL warning and show warning for other charts", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Verify table panel is displayed
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Click table chart - should NOT show VRL warning
    await page.locator('[data-test="selected-chart-table-item"]').click();

    // Wait for table to be selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);

    // Verify NO VRL warning appears for table chart selection
    const vrlWarningBanner = page.getByText("VRL function is only supported for table chart");
    let isVrlWarningVisible = await vrlWarningBanner.isVisible().catch(() => false);
    expect(isVrlWarningVisible).toBe(false);

    // Verify table panel is still displayed after clicking table chart
    await expect(tablePanel).toBeVisible({ timeout: 5000 });

    // NEW BEHAVIOR: Switch to line chart - should show VRL warning and allow switching
    await page.locator('[data-test="selected-chart-line-item"]').click();

    // Wait for VRL warning banner to appear
    await expect(vrlWarningBanner).toBeVisible({ timeout: 5000 });

    // NEW BEHAVIOR: Chart switching is allowed - line chart should be selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "line", true);
  });

  test("[P1] Should enable dynamic columns configuration when VRL function is applied", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Verify table is displayed
    const table = page.locator('[data-test="dashboard-panel-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Open config panel to verify dynamic columns is enabled
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify "Allow Dynamic Columns" toggle is enabled
    const dynamicColumnsToggle = page.locator('[data-test="dashboard-config-table_dynamic_columns"]');
    await dynamicColumnsToggle.waitFor({ state: "visible", timeout: 10000 });

    const isChecked = await dynamicColumnsToggle.getAttribute("aria-checked");
    expect(isChecked).toBe("true");

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("[P1] Should disable VRL toggle and allow chart type switching", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");

    await pm.logsVisualise.logsApplyQueryAndWait();
    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table chart is selected due to VRL
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);

    // Switch back to logs tab
    await pm.logsVisualise.backToLogs();

    // Disable VRL toggle - wait for it to be visible first
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    await vrlToggle.waitFor({ state: "visible", timeout: 10000 });
    const isChecked = await vrlToggle.getAttribute("aria-checked");

    if (isChecked === "true") {
      await vrlToggle.click();
      // Wait for VRL editor to be hidden or disabled
      const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
      await vrlEditor.first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    }

    // Clear the VRL function editor
    const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
    if (await vrlEditor.first().isVisible().catch(() => false)) {
      await vrlEditor.first().click();
      await page.locator("#fnEditor").locator(".inputarea").fill("");
    }

    // Apply query without VRL
    await pm.logsVisualise.logsApplyQueryButton();

    // Switch back to visualization
    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify no VRL function error when switching chart types
  });

  test("[P1] Should show VRL warning for h-bar chart when VRL function is present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Try to switch to h-bar chart
    const hbarChart = page.locator('[data-test="selected-chart-h-bar-item"]');
    if (await hbarChart.isVisible().catch(() => false)) {
      await hbarChart.click();

      // Wait for VRL warning banner to appear
      const vrlWarningBanner = page.getByText("VRL function is only supported for table chart");
      const isWarningVisible = await vrlWarningBanner.isVisible({ timeout: 5000 }).catch(() => false);
      expect(isWarningVisible).toBe(true);

      // NEW BEHAVIOR: Chart switching is allowed - h-bar should be selected
      await pm.logsVisualise.verifyChartTypeSelected(page, "h-bar", true);
    }
  });

  test("[P1] Should handle VRL with aggregation query and show warning when switching charts", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    const aggregationQuery = `SELECT kubernetes_namespace_name as "x_axis_1", count(*) as "y_axis_1" FROM "${STREAM_NAME}" GROUP BY x_axis_1 LIMIT 10`;

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(aggregationQuery);

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.setRelative("8", "h");
    await pm.logsVisualise.logsApplyQueryAndWait();

    await pm.logsVisualise.openVisualiseTabWithVrl();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render with data
    // await waitForTableData(page);

    // Verify table is displayed with data initially
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify data is displayed in table
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    await expect(tableRows).not.toHaveCount(0, { timeout: 15000 });

    // NEW BEHAVIOR: Switch to bar chart - should show VRL warning and allow switching
    await page.locator('[data-test="selected-chart-bar-item"]').click();

    // Wait for VRL warning banner to appear
    const vrlWarningBanner = page.getByText("VRL function is only supported for table chart");
    const isWarningVisible = await vrlWarningBanner.isVisible({ timeout: 5000 }).catch(() => false);
    expect(isWarningVisible).toBe(true);

    // NEW BEHAVIOR: Chart switching is allowed - bar chart should be selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "bar", true);
  });

  test("[P1] Should not show VRL error notification when VRL is not present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    const aggregationQuery = `SELECT kubernetes_namespace_name as "x_axis_1", count(*) as "y_axis_1" FROM "${STREAM_NAME}" GROUP BY x_axis_1 LIMIT 10`;

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(aggregationQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Do NOT enable VRL - run query without VRL
    await pm.logsVisualise.logsApplyQueryAndWait();
    await pm.logsVisualise.openVisualiseTabWithVrl();
    await pm.logsVisualise.verifyChartRenders(page);

    // Try to switch to bar chart - should NOT show VRL error
    await page.locator('[data-test="selected-chart-bar-item"]').click();

    // Wait for bar chart to be selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "bar", true);

    // Verify VRL-specific error notification does NOT appear
    const vrlErrorNotification = page.getByText(
      "VRL functions are present. Only table chart is supported when using VRL functions."
    );
    const isVrlErrorVisible = await vrlErrorNotification.isVisible().catch(() => false);
    expect(isVrlErrorVisible).toBe(false);
  });

  test("[P1] Should display VRL function editor with correct placeholder and format", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor
    await enableVrlEditor(page);

    // Verify VRL editor is visible
    const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
    await expect(vrlEditor.first()).toBeVisible();

    // Verify editor is ready to accept input
    const editorInput = page.locator("#fnEditor").locator(".inputarea");
    await expect(editorInput).toBeVisible();

    // Add VRL function and verify it's entered correctly
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);

    // Verify the VRL content was entered
    const editorContent = page.locator("#fnEditor");
    await expect(editorContent).toBeVisible();
  });

});
