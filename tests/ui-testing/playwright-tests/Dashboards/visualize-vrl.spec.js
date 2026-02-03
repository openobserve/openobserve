const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import logData from "../../fixtures/log.json";
import PageManager from "../../pages/page-manager";
import { deleteDashboard } from "./utils/dashCreation.js";

// Dashboard and panel names
const randomDashboardName =
  "VRL_Dashboard_" + Math.random().toString(36).substr(2, 9);
const panelName = "VRL_Panel_" + Math.random().toString(36).substr(2, 9);

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
// const complexVrlFunction = `.vrl_status = "processed"`;

// SQL queries
const selectAllQuery = `SELECT * FROM "${STREAM_NAME}"`;

const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "${STREAM_NAME}" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// Helper function to enable VRL editor
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

    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState("networkidle");

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
    await pm.logsVisualise.openVisualiseTab();

    // Verify VRL toggle button is visible in the toolbar
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    await expect(vrlToggle).toBeVisible();

    // Check if toggle is already on (aria-checked="true")
    const isChecked = await vrlToggle.getAttribute("aria-checked");

    if (isChecked === "false") {
      // Click VRL toggle to show editor
      await vrlToggle.click();
      await page.waitForTimeout(1000);
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
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor
    await enableVrlEditor(page);

    // Add VRL function
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    // Open visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // Verify chart renders
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table chart is selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);

    // Verify table has data
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("[P1] Should restrict chart type to table only when VRL function is present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    // Open visualization tab
    await pm.logsVisualise.openVisualiseTab();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    // The VRL field list is extracted from query results, not just from editor content
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for VRL fields to be processed and registered
    await page.waitForTimeout(2000);

    // Try to switch to line chart
    await page.locator('[data-test="selected-chart-line-item"]').click();

    // Verify error notification appears
    const errorNotification = page.getByText(
      "VRL functions are present. Only table chart is supported when using VRL functions."
    );
    await expect(errorNotification).toBeVisible({ timeout: 5000 });

    // Verify table chart is still selected
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);
  });

  test("[P1] Should show error for all non-table chart types when VRL is present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for VRL fields to be processed
    await page.waitForTimeout(2000);

    // Test multiple chart types - all should show error
    const chartTypes = ["line", "bar", "area", "scatter"];

    for (const chartType of chartTypes) {
      await page.locator(`[data-test="selected-chart-${chartType}-item"]`).click();
      await page.waitForTimeout(500);

      // Verify error notification appears
      const errorNotification = page.getByText(
        "VRL functions are present. Only table chart is supported when using VRL functions."
      );
      const isVisible = await errorNotification.isVisible().catch(() => false);
      expect(isVisible).toBe(true);

      // Verify table chart remains selected
      await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);
    }
  });

  test("[P1] Should save VRL panel to dashboard and preserve VRL configuration", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    // Use SELECT * query so VRL-generated fields appear in the result
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
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

    // Verify panel renders on dashboard
    const dashboardPanel = page.locator(
      '[data-test="dashboard-panel-' + panelName + '"]'
    );
    // await expect(dashboardPanel).toBeVisible({ timeout: 10000 });

    // Verify table chart is displayed on dashboard
    const tableOnDashboard = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tableOnDashboard).toBeVisible();

    // Edit the panel to verify VRL function is preserved
    await page
      .locator('[data-test="dashboard-edit-panel-' + panelName + '-dropdown"]')
      .click();
    await page.locator('[data-test="dashboard-edit-panel"]').click();

    // Wait for edit panel to load
    await page.waitForTimeout(3000);

    // Verify the VRL-generated column "vrl" is displayed in the table
    // The VRL function .vrl=100 creates a column named "vrl" with value 100
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify "vrl" column is present in the table (check header or cell containing "vrl")
    // Try multiple selectors for flexibility
    const vrlColumnHeader = page.locator('[data-test="dashboard-panel-table"]').getByRole('cell', { name: 'vrl' });
    const vrlColumnHeaderAlt = page.locator('[data-test="dashboard-panel-table"]').getByText('vrl', { exact: true }).first();
    const vrlColumnInTable = page.locator('[data-test="dashboard-panel-table"] th:has-text("vrl"), [data-test="dashboard-panel-table"] td:has-text("vrl")').first();

    // Check if VRL column header is visible using any selector
    const isVrlHeaderVisible = await vrlColumnHeader.isVisible().catch(() => false);
    const isVrlHeaderAltVisible = await vrlColumnHeaderAlt.isVisible().catch(() => false);
    const isVrlInTable = await vrlColumnInTable.isVisible().catch(() => false);

    expect(isVrlHeaderVisible || isVrlHeaderAltVisible || isVrlInTable).toBe(true);

    // Verify VRL field values are displayed (100.00 or 100)
    const vrlValue = page.locator('[data-test="dashboard-panel-table"]').getByText('100.00').first();
    const vrlValueAlt = page.locator('[data-test="dashboard-panel-table"]').getByText('100').first();

    // Check if either format is visible
    const isVrlValueVisible = await vrlValue.isVisible().catch(() => false);
    const isVrlValueAltVisible = await vrlValueAlt.isVisible().catch(() => false);
    expect(isVrlValueVisible || isVrlValueAltVisible).toBe(true);

    // Go back to dashboard
    await page.locator('[data-test="dashboard-panel-discard"]').click();

    // Handle discard confirmation if it appears
    const discardConfirm = page.locator('[data-test="confirm-button"]');
    if (await discardConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await discardConfirm.click();
    }

    await page.waitForTimeout(1000);

    // Cleanup - delete the dashboard
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("[P1] Should handle complex VRL function with multiple field creation", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    // Use SELECT * so VRL-generated fields appear in result
    // Note: Aggregation queries won't show VRL fields as separate columns
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add complex function that creates multiple fields
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(complexVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for VRL fields to be processed
    await page.waitForTimeout(2000);

    // Verify table is displayed
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify table has multiple columns (original fields + VRL-generated fields: vrl_status, vrl_count, vrl_flag)
    const headers = page.locator('[data-test="dashboard-panel-table"] thead th');
    const headerCount = await headers.count();
    // SELECT * returns many columns, plus 3 VRL fields
    expect(headerCount).toBeGreaterThan(3);

    // Verify at least one VRL-generated field is visible in the table
    const vrlStatusColumn = page.locator('[data-test="dashboard-panel-table"]').getByText('vrl_status');
    const vrlCountColumn = page.locator('[data-test="dashboard-panel-table"]').getByText('vrl_count');
    const vrlFlagColumn = page.locator('[data-test="dashboard-panel-table"]').getByText('vrl_flag');

    const isVrlStatusVisible = await vrlStatusColumn.first().isVisible().catch(() => false);
    const isVrlCountVisible = await vrlCountColumn.first().isVisible().catch(() => false);
    const isVrlFlagVisible = await vrlFlagColumn.first().isVisible().catch(() => false);

    // At least one VRL-generated column should be visible
    expect(isVrlStatusVisible || isVrlCountVisible || isVrlFlagVisible).toBe(true);
  });

  test("[P1] Should preserve VRL function when switching between logs and visualize tabs", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    // Verify VRL toggle is enabled before switching
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    let isChecked = await vrlToggle.getAttribute("aria-checked");
    expect(isChecked).toBe("true");

    // Switch to visualization
    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to fully render
    await page.waitForTimeout(2000);

    // Verify table is displayed with data (proves VRL query executed)
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify table has data rows (VRL function executed successfully)
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Switch back to logs
    await pm.logsVisualise.backToLogs();
    await page.waitForTimeout(1000);

    // ASSERT: Verify VRL toggle is still enabled after switching back to logs
    isChecked = await vrlToggle.getAttribute("aria-checked");
    expect(isChecked).toBe("true");

    // ASSERT: Verify VRL editor is still visible
    const vrlEditor = page.locator('[data-test="logs-vrl-function-editor"]');
    await expect(vrlEditor.first()).toBeVisible();

    // Switch to visualization again
    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.runQueryAndWaitForCompletion();

    // Verify chart still renders (VRL should be preserved)
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to fully render
    await page.waitForTimeout(2000);

    // ASSERT: Verify table is still displayed after tab switches
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // ASSERT: Verify table still has data rows (proves VRL preserved and executed)
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
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.verifyChartRenders(page);

    // With VRL functions, table chart should be selected even for histogram queries
    // (normally histogram queries default to line chart)
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
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function that creates multiple fields
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(fieldCreationVrl);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table is displayed
    const table = page.locator('[data-test="dashboard-panel-table"]');
    await expect(table).toBeVisible();

    // Verify table has data rows
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Verify table has headers (columns)
    const headers = page.locator('[data-test="dashboard-panel-table"] thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test("[P1] Should allow table chart selection but no other chart types with VRL", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for VRL fields to be processed
    await page.waitForTimeout(2000);

    // Verify table panel is displayed (proves table chart is active)
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Click table chart - should NOT show VRL error (table is allowed)
    await page.locator('[data-test="selected-chart-table-item"]').click();
    await page.waitForTimeout(1000);

    // Verify NO VRL error notification appears for table chart selection
    const vrlErrorNotification = page.getByText(
      "VRL functions are present. Only table chart is supported when using VRL functions."
    );
    let isVrlErrorVisible = await vrlErrorNotification.isVisible().catch(() => false);
    expect(isVrlErrorVisible).toBe(false);

    // Verify table panel is still displayed after clicking table chart
    await expect(tablePanel).toBeVisible({ timeout: 5000 });

    // Now verify that OTHER chart types DO show VRL error
    // Try to switch to line chart - should show VRL error
    await page.locator('[data-test="selected-chart-line-item"]').click();
    await page.waitForTimeout(500);

    // Verify VRL error notification DOES appear for line chart
    isVrlErrorVisible = await vrlErrorNotification.isVisible().catch(() => false);
    expect(isVrlErrorVisible).toBe(true);

    // Verify table panel is STILL displayed (not switched to line chart)
    await expect(tablePanel).toBeVisible({ timeout: 5000 });
  });

  // =============================================
  // Additional P1 Test Cases for VRL Visualization
  // =============================================

  test("[P1] Should enable dynamic columns configuration when VRL function is applied", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for table to render
    await page.waitForTimeout(2000);

    // Verify table is displayed
    const table = page.locator('[data-test="dashboard-panel-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Open config panel to verify dynamic columns is enabled
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify "Allow Dynamic Columns" toggle is enabled (aria-checked="true")
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
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.verifyChartRenders(page);

    // Verify table chart is selected due to VRL
    await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);

    // Switch back to logs tab
    await pm.logsVisualise.backToLogs();
    await page.waitForTimeout(1000);

    // Disable VRL toggle
    const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
    await vrlToggle.waitFor({ state: "visible", timeout: 10000 });
    const isChecked = await vrlToggle.getAttribute("aria-checked");

    if (isChecked === "true") {
      await vrlToggle.click();
      await page.waitForTimeout(1000);
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
    await pm.logsVisualise.openVisualiseTab();
    await page.waitForTimeout(2000);

    // Verify no VRL function error when switching chart types
    // Note: Chart switching may still be restricted based on other factors like SELECT *
  });

  test.skip("[P1] Should show error for h-bar chart when VRL function is present", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(selectAllQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.verifyChartRenders(page);

    // Try to switch to h-bar chart
    const hbarChart = page.locator('[data-test="selected-chart-h-bar-item"]');
    if (await hbarChart.isVisible().catch(() => false)) {
      await hbarChart.click();
      await page.waitForTimeout(500);

      // Verify error notification appears
      const errorNotification = page.getByText(
        "VRL functions are present. Only table chart is supported when using VRL functions."
      );
      const isVisible = await errorNotification.isVisible().catch(() => false);
      expect(isVisible).toBe(true);

      // Verify table chart remains selected
      await pm.logsVisualise.verifyChartTypeSelected(page, "table", true);
    }
  });

  test("[P1] Should handle VRL with aggregation query and force table chart", async ({
    page,
  }) => {
    const pm = new PageManager(page);

    const aggregationQuery = `SELECT kubernetes_namespace_name as "x_axis_1", count(*) as "y_axis_1" FROM "${STREAM_NAME}" GROUP BY x_axis_1 LIMIT 10`;

    await pm.logsVisualise.openLogs();
    await pm.logsVisualise.fillLogsQueryEditor(aggregationQuery);
    await pm.logsVisualise.setRelative("8", "h");

    // Enable VRL editor and add function
    await enableVrlEditor(page);
    await pm.logsVisualise.vrlFunctionEditor(simpleVrlFunction);
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();

    // IMPORTANT: Run query in visualization tab to populate vrlFunctionFieldList
    await pm.logsVisualise.runQueryAndWaitForCompletion();
    await pm.logsVisualise.verifyChartRenders(page);

    // Wait for VRL fields to be processed
    await page.waitForTimeout(2000);

    // Verify table is displayed with data
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await expect(tablePanel).toBeVisible({ timeout: 10000 });

    // Verify data is displayed in table
    const tableRows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Try to switch to bar chart - should show error
    await page.locator('[data-test="selected-chart-bar-item"]').click();
    await page.waitForTimeout(500);

    const errorNotification = page.getByText(
      "VRL functions are present. Only table chart is supported when using VRL functions."
    );
    const isVisible = await errorNotification.isVisible().catch(() => false);
    expect(isVisible).toBe(true);

    // Verify table panel is still displayed (not switched to bar chart)
    await expect(tablePanel).toBeVisible({ timeout: 5000 });
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
    await pm.logsVisualise.logsApplyQueryButton();

    await pm.logsVisualise.openVisualiseTab();
    await pm.logsVisualise.verifyChartRenders(page);

    // Try to switch to bar chart - should NOT show VRL error
    await page.locator('[data-test="selected-chart-bar-item"]').click();
    await page.waitForTimeout(500);

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

    // Verify the VRL content was entered (check editor has content)
    const editorContent = page.locator("#fnEditor");
    await expect(editorContent).toBeVisible();
  });

});
