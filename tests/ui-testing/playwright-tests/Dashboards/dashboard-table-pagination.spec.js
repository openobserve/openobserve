const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
const testLogger = require('../utils/test-logger.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

// Helper function to generate unique dashboard name per test
const generateUniqueDashboardName = () => 
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

// Configure tests to run in parallel for better performance across the suite
// Ensure each test uses unique resources (e.g., dashboard names) to avoid race conditions
test.describe.configure({ mode: "parallel" });

// Add retries for flaky network conditions
test.describe.configure({ retries: 1 });

/**
 * Dashboard Table Chart - Pagination Feature Tests
 *
 * FEATURE OVERVIEW:
 * - Pagination toggle is available in the Config panel for Table chart type only
 * - When enabled, users can set "table_pagination_rows_per_page" to control how many rows appear per page
 * - Works for both SQL and PromQL table charts
 * - Default: pagination is OFF, showing all rows with virtual scroll
 * - When ON: pagination controls appear at the bottom of the table
 *
 * CONFIG PANEL ELEMENTS:
 * - [data-test="dashboard-config-show-pagination"] - Pagination toggle
 * - [data-test="dashboard-config-rows-per-page"] - Rows per page input (visible when pagination is enabled)
 * - [data-test="dashboard-config-rows-per-page-info"] - Info icon for rows per page
 *
 * TABLE PAGINATION ELEMENTS:
 * - Records per page dropdown
 * - Row count display (e.g., "1-10 of 100")
 * - Navigation buttons (first, prev, next, last)
 */
test.describe("Dashboard Table Chart Pagination Feature - SQL Tables", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("should show pagination toggle only for table chart type", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create a new dashboard
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // First, check with line chart (default) - pagination toggle should NOT be visible
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify pagination toggle is NOT visible for line chart
    const paginationToggleLine = page.locator('[data-test="dashboard-config-show-pagination"]');
    await expect(paginationToggleLine).not.toBeVisible();

    testLogger.info('Verified pagination toggle is NOT visible for line chart');

    // Now switch to table chart type
    await pm.chartTypeSelector.selectChartType("table");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify pagination toggle IS visible for table chart
    const paginationToggleTable = page.locator('[data-test="dashboard-config-show-pagination"]');
    await expect(paginationToggleTable).toBeVisible();

    testLogger.info('Verified pagination toggle IS visible for table chart');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should enable pagination and show rows per page input", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify pagination toggle is visible
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await expect(paginationToggle).toBeVisible();

    // Verify rows per page input is NOT visible when pagination is disabled
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await expect(rowsPerPageInput).not.toBeVisible();

    testLogger.info('Verified rows per page input is hidden when pagination is disabled');

    // Enable pagination
    await paginationToggle.click();
    await rowsPerPageInput.waitFor({ state: "visible" });

    // Verify rows per page input IS now visible
    await expect(rowsPerPageInput).toBeVisible();

    testLogger.info('Verified rows per page input is visible when pagination is enabled');

    // Verify info icon is visible
    const infoIcon = page.locator('[data-test="dashboard-config-rows-per-page-info"]');
    await expect(infoIcon).toBeVisible();

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should set custom rows per page value", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Enable pagination
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Wait for rows per page input to be visible
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });

    // Set custom rows per page value
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("25");

    testLogger.info('Set custom rows per page value to 25');

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify the input value is preserved
    const inputValue = await rowsPerPageInput.inputValue();
    expect(inputValue).toBe("25");

    testLogger.info('Verified rows per page value is preserved after apply');

    // Save and clean up
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should display pagination controls in table when enabled", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Apply and wait for table data
    const streamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await streamPromise;
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Set rows per page to 10
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("10");

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify pagination controls are visible in the table
    const tableBottom = page.locator('[data-test="dashboard-panel-table"] .q-table__bottom');
    await expect(tableBottom).toBeVisible();

    // Check for "Records per page" text
    const rowsPerPageText = page.locator('[data-test="dashboard-panel-table"]').getByText('Records per page');
    await expect(rowsPerPageText).toBeVisible();

    testLogger.info('Verified pagination controls are visible in table');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should hide pagination controls when pagination is disabled", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Apply and wait for table data
    const streamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await streamPromise;
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Open config panel - pagination should be disabled by default
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify pagination is disabled
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    const isChecked = await paginationToggle.getAttribute('aria-checked');
    expect(isChecked).toBe('false');

    // Apply to ensure table renders with pagination disabled
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify "Records per page" text is NOT visible
    const rowsPerPageText = page.locator('[data-test="dashboard-panel-table"]').getByText('Records per page');
    await expect(rowsPerPageText).not.toBeVisible();

    testLogger.info('Verified pagination controls are hidden when disabled');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should persist pagination settings after save and reload", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel and enable pagination with custom value
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("50");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Save the panel
    await pm.dashboardPanelActions.savePanel();

    // Wait for panel to be saved - the panel dropdown should be visible after save
    await page.locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`).waitFor({ state: "visible", timeout: 30000 });

    testLogger.info('Saved panel with pagination enabled and table_pagination_rows_per_page=50');

    // Edit the panel again
    await pm.dashboardPanelActions.selectPanelAction(panelName, "Edit");

    // Wait for edit mode to load
    await page.locator('[data-test="dashboard-apply"]').waitFor({ state: "visible", timeout: 30000 });

    // Open config panel and verify settings persisted
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify pagination is still enabled
    const paginationToggleAfter = page.locator('[data-test="dashboard-config-show-pagination"]');
    const isChecked = await paginationToggleAfter.getAttribute('aria-checked');
    expect(isChecked).toBe('true');

    // Verify rows per page value
    const rowsPerPageAfter = page.locator('[data-test="dashboard-config-rows-per-page"]');
    const value = await rowsPerPageAfter.inputValue();
    expect(value).toBe('50');

    testLogger.info('Verified pagination settings persisted after save');

    // Clean up - save panel first before navigating back (we're in edit mode again)
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should toggle pagination on and off correctly", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');

    // Initial state: pagination OFF, rows per page hidden
    await expect(rowsPerPageInput).not.toBeVisible();

    // Enable pagination
    await paginationToggle.click();
    await rowsPerPageInput.waitFor({ state: "visible" });
    await expect(rowsPerPageInput).toBeVisible();

    testLogger.info('Toggled pagination ON - rows per page input is visible');

    // Disable pagination
    await paginationToggle.click();
    await rowsPerPageInput.waitFor({ state: "hidden" });
    await expect(rowsPerPageInput).not.toBeVisible();

    testLogger.info('Toggled pagination OFF - rows per page input is hidden');

    // Enable again
    await paginationToggle.click();
    await rowsPerPageInput.waitFor({ state: "visible" });
    await expect(rowsPerPageInput).toBeVisible();

    testLogger.info('Toggled pagination ON again - verified toggle works correctly');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should display row count information correctly", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Apply and wait for table data
    const streamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await streamPromise;
    await pm.chartTypeSelector.waitForTableDataLoad();

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Set rows per page to 10
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("10");

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Check that row count text is displayed (format: "X-Y of Z")
    const tableBottom = page.locator('[data-test="dashboard-panel-table"] .q-table__bottom');
    await tableBottom.waitFor({ state: "visible" });
    const bottomText = await tableBottom.textContent();
    
    // Verify the text contains the expected format (e.g., "1-10 of 100" or similar)
    expect(bottomText).toMatch(/\d+-\d+\s+of\s+\d+/);

    testLogger.info('Verified row count information is displayed correctly');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should not show pagination toggle for non-table chart types", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Test with area chart (default non-table type)
    await pm.chartTypeSelector.selectChartType("area");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify pagination toggle is NOT visible for area chart
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await expect(paginationToggle).not.toBeVisible();
    testLogger.info('Verified pagination toggle is hidden for area chart');

    // Now switch to table chart and verify pagination toggle IS visible
    await pm.chartTypeSelector.selectChartType("table");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify pagination toggle IS visible for table chart
    await expect(paginationToggle).toBeVisible();
    testLogger.info('Verified pagination toggle is visible for table chart');

    // Switch back to bar chart and verify pagination toggle is hidden
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify pagination toggle is NOT visible for bar chart
    await expect(paginationToggle).not.toBeVisible();
    testLogger.info('Verified pagination toggle is hidden for bar chart');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should work with wrap cells option", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Enable pagination
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Set rows per page
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("20");

    // Also enable wrap cells
    await pm.dashboardPanelConfigs.selectWrapCell();

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify both options are active
    const paginationChecked = await paginationToggle.getAttribute('aria-checked');
    expect(paginationChecked).toBe('true');

    // Verify table has wrap-enabled class
    const table = page.locator('[data-test="dashboard-panel-table"]');
    const tableClasses = await table.getAttribute('class');
    expect(tableClasses).toContain('wrap-enabled');

    testLogger.info('Verified pagination works with wrap cells option');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should work with transpose option", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Enable pagination
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Set rows per page
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("15");

    // Also enable transpose
    await pm.dashboardPanelConfigs.selectTranspose();

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify both settings are active
    const paginationChecked = await paginationToggle.getAttribute('aria-checked');
    expect(paginationChecked).toBe('true');

    testLogger.info('Verified pagination works with transpose option');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should handle rows per page input validation - minimum value", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Verify the input has min="1" attribute
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });
    const minAttr = await rowsPerPageInput.getAttribute('min');
    expect(minAttr).toBe('1');

    testLogger.info('Verified rows per page input has min=1 attribute');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should use default value when rows per page is empty", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Apply and wait for data
    const streamPromise = waitForStreamComplete(page);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await streamPromise;

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Leave rows per page empty (clear any default)
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("");

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Table should still work with default value (10)
    const tableBottom = page.locator('[data-test="dashboard-panel-table"] .q-table__bottom');
    await tableBottom.waitFor({ state: "visible" });
    await expect(tableBottom).toBeVisible();

    testLogger.info('Verified table works with empty rows per page (uses default)');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should switch between chart types and preserve pagination settings", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel and enable pagination with custom value
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("30");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Switch to bar chart
    await pm.chartTypeSelector.selectChartType("bar");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Pagination toggle should not be visible for bar chart
    await expect(paginationToggle).not.toBeVisible();

    // Switch back to table chart
    await pm.chartTypeSelector.selectChartType("table");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Pagination toggle should be visible again
    await expect(paginationToggle).toBeVisible();

    // Verify the pagination settings are preserved
    const isChecked = await paginationToggle.getAttribute('aria-checked');
    expect(isChecked).toBe('true');

    const value = await rowsPerPageInput.inputValue();
    expect(value).toBe('30');

    testLogger.info('Verified pagination settings preserved when switching chart types');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should display info tooltip for rows per page", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);
    await pm.chartTypeSelector.selectChartType("table");
    await pm.chartTypeSelector.selectStreamType("logs");
    await pm.chartTypeSelector.selectStream("e2e_automate");
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Wait for rows per page input to be visible
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });

    // Hover over the info icon to see tooltip
    const infoIcon = page.locator('[data-test="dashboard-config-rows-per-page-info"]');
    await expect(infoIcon).toBeVisible();
    await infoIcon.hover();

    // Verify tooltip appears with expected text
    const tooltip = page.locator('.q-tooltip');
    await expect(tooltip).toBeVisible();
    const tooltipText = await tooltip.textContent();
    expect(tooltipText).toContain('default number of records');

    testLogger.info('Verified info tooltip is displayed for rows per page');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should work with custom SQL query table", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("pagination-test");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add panel
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Open Custom SQL editor
    await page.locator('[data-test="dashboard-sql-query-type"]').click();
    await page.locator('[data-test="dashboard-custom-query-type"]').click();

    // Focus on the editor
    await page.locator('[data-test="dashboard-panel-query-editor"]').getByRole('code').click();
    await page.locator('[data-test="dashboard-panel-query-editor"]').locator('.inputarea').fill(
      'SELECT kubernetes_container_name, count(*) as count FROM "e2e_automate" GROUP BY kubernetes_container_name'
    );

    // Select table chart type
    await pm.chartTypeSelector.selectChartType("table");

    // Add field for table
    await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

    // Apply
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await expect(paginationToggle).toBeVisible();

    await paginationToggle.click();

    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });
    await expect(rowsPerPageInput).toBeVisible();
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("5");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Verify pagination controls are visible
    const rowsPerPageText = page.locator('[data-test="dashboard-panel-table"]').getByText('Records per page');
    await rowsPerPageText.waitFor({ state: "visible" });
    await expect(rowsPerPageText).toBeVisible();

    testLogger.info('Verified pagination works with custom SQL query table');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});

test.describe("Dashboard Table Chart Pagination Feature - PromQL Tables", () => {
  // Ensure metrics are ingested once before all PromQL tests run
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    // Note: Metrics ingestion is handled by beforeAll, logs ingestion not needed for PromQL tests
  });

  test("should enable pagination for PromQL table chart", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("promql-pagination");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel with PromQL
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select table chart type first
    await pm.chartTypeSelector.selectChartType("table");

    // Select metrics stream type (required for PromQL button to appear)
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Check if PromQL button is visible (only shows for metrics stream type)
    const promqlButton = page.locator('[data-test="dashboard-promql-query-type"]');
    const isPromqlVisible = await promqlButton.isVisible().catch(() => false);

    if (!isPromqlVisible) {
      testLogger.warn('PromQL button not visible - metrics stream type may not support PromQL or no metrics data available');
      // Skip test gracefully if PromQL is not available
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
      test.skip(true, 'PromQL button not available for metrics stream');
      return;
    }

    // Switch to PromQL mode
    await promqlButton.click();

    // Switch to Custom mode to enable the query editor for manual input
    const customButton = page.locator('[data-test="dashboard-custom-query-type"]');
    await customButton.waitFor({ state: "visible", timeout: 5000 });
    await customButton.click();

    // Wait for query editor to appear (uses same editor for SQL and PromQL)
    const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 10000 });

    // Focus on the editor and enter a simple PromQL query using keyboard.type for reliable Monaco input
    await queryEditor.getByRole('code').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('up');
    await page.keyboard.press('Escape'); // Dismiss any Monaco autocomplete suggestions

    // Apply
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel
    await pm.dashboardPanelConfigs.openConfigPanel();

    // Verify pagination toggle is visible for PromQL table
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await expect(paginationToggle).toBeVisible();

    // Enable pagination
    await paginationToggle.click();

    // Verify rows per page input appears
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.waitFor({ state: "visible" });
    await expect(rowsPerPageInput).toBeVisible();

    // Set rows per page
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("20");

    // Apply changes
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    testLogger.info('Verified pagination works for PromQL table chart');

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });

  test("should display pagination controls in PromQL table with legend filter", async ({
    page,
  }) => {
    const dashboardName = generateUniqueDashboardName();
    const pm = new PageManager(page);
    const panelName =
      pm.dashboardPanelActions.generateUniquePanelName("promql-pagination");

    // Navigate to dashboards
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    // Create dashboard and add table panel with PromQL
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Select table chart type first
    await pm.chartTypeSelector.selectChartType("table");

    // Select metrics stream type (required for PromQL button to appear)
    await pm.chartTypeSelector.selectStreamType("metrics");

    // Check if PromQL button is visible (only shows for metrics stream type)
    const promqlButton = page.locator('[data-test="dashboard-promql-query-type"]');
    const isPromqlVisible = await promqlButton.isVisible().catch(() => false);

    if (!isPromqlVisible) {
      testLogger.warn('PromQL button not visible - metrics stream type may not support PromQL or no metrics data available');
      // Skip test gracefully if PromQL is not available
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
      test.skip(true, 'PromQL button not available for metrics stream');
      return;
    }

    // Switch to PromQL mode
    await promqlButton.click();

    // Switch to Custom mode to enable the query editor for manual input
    const customButton = page.locator('[data-test="dashboard-custom-query-type"]');
    await customButton.waitFor({ state: "visible", timeout: 5000 });
    await customButton.click();

    // Wait for query editor to appear (uses same editor for SQL and PromQL)
    const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
    await queryEditor.waitFor({ state: "visible", timeout: 10000 });

    // Focus on the editor and enter a PromQL query using keyboard.type for reliable Monaco input
    await queryEditor.getByRole('code').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('up');
    await page.keyboard.press('Escape'); // Dismiss any Monaco autocomplete suggestions

    // Apply
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Open config panel and enable pagination
    await pm.dashboardPanelConfigs.openConfigPanel();
    const paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    await paginationToggle.click();

    // Set rows per page
    const rowsPerPageInput = page.locator('[data-test="dashboard-config-rows-per-page"]');
    await rowsPerPageInput.click();
    await rowsPerPageInput.fill("10");

    // Apply changes and wait for table data to load
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    // Wait for the table to render with data rows
    // Quasar's q-table with hide-no-data does NOT render .q-table__bottom when rows are empty
    const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
    await tablePanel.waitFor({ state: "visible", timeout: 15000 });

    // Wait for table rows - if first attempt returns no data, re-apply to retry the query
    const tableRows = tablePanel.locator('tbody tr, .q-table__grid-content .q-card');
    let hasRows = await tableRows.first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);

    if (!hasRows) {
      testLogger.warn('No table rows on first attempt - re-applying query to retry');
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();
      hasRows = await tableRows.first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    }

    // Data is required for pagination to render - fail clearly if still no data
    expect(hasRows, 'PromQL query "up" must return data rows for pagination test - check metrics ingestion').toBe(true);

    // Wait for the table bottom container which holds all pagination controls
    const tableBottom = tablePanel.locator('.q-table__bottom');
    await tableBottom.waitFor({ state: "visible", timeout: 15000 });

    // Verify "Records per page:" text is visible (note: text includes colon)
    const rowsPerPageText = tableBottom.locator('span.text-caption').filter({ hasText: 'Records per page' });
    await expect(rowsPerPageText).toBeVisible({ timeout: 10000 });

    // Verify the record count display shows correct format (e.g., "1-10 of 99")
    // The pagination info is in a span with class "text-caption q-pa-sm"
    const paginationInfo = tableBottom.locator('span.text-caption').filter({ hasText: /\d+-\d+\s+of\s+\d+/ });
    await expect(paginationInfo).toBeVisible({ timeout: 5000 });

    // Verify pagination shows correct format (e.g., "1-10 of X" or "1-N of N" if fewer records)
    const paginationText = await paginationInfo.textContent();
    expect(paginationText.trim()).toMatch(/^\d+-\d+\s+of\s+\d+$/);

    // Verify we're on the first page (starts with "1-")
    expect(paginationText.trim().startsWith('1-')).toBe(true);

    testLogger.info(`Verified PromQL table pagination: ${paginationText.trim()}`);

    // Clean up - save panel first before navigating back
    await pm.dashboardPanelActions.savePanel();
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
  });
});
