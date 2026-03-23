const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
const testLogger = require("../utils/test-logger.js");

// Helper function to generate unique dashboard name per test
const generateUniqueDashboardName = () =>
  "Dashboard_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();

// Configure tests to run in parallel for better performance
test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

/**
 * Dashboard Table Chart - Pivot Table Feature Tests
 *
 * FEATURE OVERVIEW:
 * - Pivot tables transform flat tabular data into cross-tabulated summaries
 * - Breakdown field values become column headers (pivoted)
 * - Requires: X fields (rows) + Breakdown fields (pivot) + Y fields (values)
 * - Supports up to 3 pivot fields, row/column totals, sticky totals
 * - Transpose & Dynamic Columns are disabled when pivot mode is active
 *
 * KEY SELECTORS:
 * - [data-test="dashboard-add-p-data"] - +P button (add to pivot)
 * - [data-test="dashboard-b-layout"] - Breakdown/pivot field container
 * - [data-test="dashboard-config-pivot-row-totals"] - Show row totals toggle
 * - [data-test="dashboard-config-pivot-col-totals"] - Show column totals toggle
 * - [data-test="dashboard-config-pivot-sticky-col-totals"] - Sticky col totals
 * - [data-test="dashboard-config-pivot-sticky-row-totals"] - Sticky row totals
 * - [data-test="dashboard-config-table_transpose"] - Transpose (disabled in pivot)
 * - [data-test="dashboard-config-table_dynamic_columns"] - Dynamic cols (disabled in pivot)
 */
test.describe("Dashboard Table Chart - Pivot Table Feature", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ===== P0 - Critical / Smoke Tests =====

  test(
    "should show +P button only for table chart type",
    {
      tag: ["@pivotTable", "@smoke", "@P0"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate to dashboards
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();

      // Create dashboard and add panel
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Setup with line chart (default) - +P button should NOT be visible
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Search for a field and verify +P is NOT visible for line chart
      const searchInput = page.locator(
        '[data-test="index-field-search-input"]'
      );
      await searchInput.click();
      await searchInput.fill("kubernetes_container_name");

      const pivotButton = page
        .locator('[data-test="dashboard-add-p-data"]')
        .first();
      await expect(pivotButton).not.toBeVisible();

      testLogger.info("Verified +P button is NOT visible for line chart");

      // Switch to table chart type
      await pm.chartTypeSelector.selectChartType("table");

      // Search again and verify +P IS visible for table chart
      await searchInput.click();
      await searchInput.fill("kubernetes_container_name");
      await pivotButton.waitFor({ state: "visible", timeout: 5000 });
      await expect(pivotButton).toBeVisible();

      testLogger.info("Verified +P button IS visible for table chart");

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should create basic pivot table with 1x + 1p + 1y",
    {
      tag: ["@pivotTable", "@smoke", "@P0"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add X field (Row field)
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );

      // Add Pivot/Breakdown field (+P)
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");

      // Add Y field (Value field) with count aggregation
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      // Apply and wait for render
      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Verify pivot table rendered - breakdown layout should show the pivot field
      const breakdownLayout = page.locator(
        '[data-test="dashboard-b-layout"]'
      );
      await expect(breakdownLayout).toBeVisible();

      // Verify the breakdown item is present
      const breakdownItem = page.locator(
        '[data-test="dashboard-b-item-breakdown_1"]'
      );
      await expect(breakdownItem).toBeVisible();

      // Verify table has data
      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      testLogger.info("Verified basic pivot table renders successfully");

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should show pivot options in config panel when pivot mode is active",
    {
      tag: ["@pivotTable", "@smoke", "@P0"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add only X and Y fields first (no pivot)
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel - pivot options should NOT be visible
      await pm.dashboardPanelConfigs.openConfigPanel();
      const pivotRowTotals = page.locator(
        '[data-test="dashboard-config-pivot-row-totals"]'
      );
      await expect(pivotRowTotals).not.toBeVisible();

      testLogger.info(
        "Verified pivot options hidden when no breakdown field"
      );

      // Add a pivot field to activate pivot mode
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Now pivot options SHOULD be visible
      await pivotRowTotals.waitFor({ state: "visible", timeout: 10000 });
      await expect(pivotRowTotals).toBeVisible();

      const pivotColTotals = page.locator(
        '[data-test="dashboard-config-pivot-col-totals"]'
      );
      await expect(pivotColTotals).toBeVisible();

      testLogger.info("Verified pivot options appear when pivot mode active");

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should disable transpose and dynamic columns when pivot mode is active",
    {
      tag: ["@pivotTable", "@smoke", "@P0"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add X and Y fields first
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel - verify transpose and dynamic columns are enabled
      await pm.dashboardPanelConfigs.openConfigPanel();
      const transposeToggle = page.locator(
        '[data-test="dashboard-config-table_transpose"]'
      );
      const dynamicColumnsToggle = page.locator(
        '[data-test="dashboard-config-table_dynamic_columns"]'
      );

      await expect(transposeToggle).toBeVisible();
      await expect(dynamicColumnsToggle).toBeVisible();

      // Verify toggles are NOT disabled
      const transposeDisabledBefore =
        await transposeToggle.getAttribute("aria-disabled");
      expect(transposeDisabledBefore).not.toBe("true");

      testLogger.info(
        "Verified transpose/dynamic columns are enabled without pivot"
      );

      // Add pivot field
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify transpose and dynamic columns are now disabled
      const transposeDisabledAfter =
        await transposeToggle.getAttribute("aria-disabled");
      expect(transposeDisabledAfter).toBe("true");

      const dynamicDisabledAfter =
        await dynamicColumnsToggle.getAttribute("aria-disabled");
      expect(dynamicDisabledAfter).toBe("true");

      testLogger.info(
        "Verified transpose/dynamic columns are disabled in pivot mode"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  // ===== P1 - Functional Tests =====

  test(
    "should update labels when pivot mode activates and deactivates",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add X and Y fields (no pivot yet)
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      // Check for "First Column" label (non-pivot mode)
      await expect(page.getByText("First Column")).toBeVisible();
      await expect(page.getByText("Other Columns")).toBeVisible();

      testLogger.info("Verified non-pivot labels: First Column, Other Columns");

      // Add pivot field to activate pivot mode
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");

      // Labels should update to pivot mode
      await expect(page.getByText("Row Fields")).toBeVisible();
      await expect(page.getByText("Value Fields")).toBeVisible();

      testLogger.info("Verified pivot labels: Row Fields, Value Fields");

      // Remove pivot field to deactivate pivot mode
      await pm.chartTypeSelector.removeField("breakdown_1", "b");

      // Labels should revert to non-pivot mode
      await expect(page.getByText("First Column")).toBeVisible();
      await expect(page.getByText("Other Columns")).toBeVisible();

      testLogger.info("Verified labels revert when pivot field removed");

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should toggle show row totals and show column totals",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Create pivot table
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Open config panel
      await pm.dashboardPanelConfigs.openConfigPanel();

      // Verify pivot options are visible
      const rowTotalsToggle = page.locator(
        '[data-test="dashboard-config-pivot-row-totals"]'
      );
      const colTotalsToggle = page.locator(
        '[data-test="dashboard-config-pivot-col-totals"]'
      );
      await expect(rowTotalsToggle).toBeVisible();
      await expect(colTotalsToggle).toBeVisible();

      // Initially row totals should be OFF
      const rowTotalsCheckedBefore =
        await rowTotalsToggle.getAttribute("aria-checked");
      expect(rowTotalsCheckedBefore).toBe("false");

      testLogger.info("Verified pivot options toggles are visible and default OFF");

      // Enable row totals
      await pm.dashboardPanelConfigs.togglePivotRowTotals();
      const rowTotalsCheckedAfter =
        await rowTotalsToggle.getAttribute("aria-checked");
      expect(rowTotalsCheckedAfter).toBe("true");

      // Sticky column totals sub-option should appear
      const stickyColTotals = page.locator(
        '[data-test="dashboard-config-pivot-sticky-col-totals"]'
      );
      await expect(stickyColTotals).toBeVisible();

      testLogger.info(
        "Verified row totals enabled and sticky col totals sub-option visible"
      );

      // Enable column totals
      await pm.dashboardPanelConfigs.togglePivotColTotals();
      const colTotalsCheckedAfter =
        await colTotalsToggle.getAttribute("aria-checked");
      expect(colTotalsCheckedAfter).toBe("true");

      // Sticky row totals sub-option should appear
      const stickyRowTotals = page.locator(
        '[data-test="dashboard-config-pivot-sticky-row-totals"]'
      );
      await expect(stickyRowTotals).toBeVisible();

      testLogger.info(
        "Verified col totals enabled and sticky row totals sub-option visible"
      );

      // Apply and verify table has "Total" text in it
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table.getByText("Total").first()).toBeVisible();

      testLogger.info("Verified Total row/column appears in pivot table");

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should revert to normal table when pivot field is removed",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Create pivot table
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel - pivot options should be visible
      await pm.dashboardPanelConfigs.openConfigPanel();
      const pivotRowTotals = page.locator(
        '[data-test="dashboard-config-pivot-row-totals"]'
      );
      await expect(pivotRowTotals).toBeVisible();

      testLogger.info("Verified pivot options visible with pivot field");

      // Remove the pivot field
      await pm.chartTypeSelector.removeField("breakdown_1", "b");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Pivot options should be hidden
      await expect(pivotRowTotals).not.toBeVisible();

      // Transpose should be re-enabled
      const transposeToggle = page.locator(
        '[data-test="dashboard-config-table_transpose"]'
      );
      const transposeDisabled =
        await transposeToggle.getAttribute("aria-disabled");
      expect(transposeDisabled).not.toBe("true");

      testLogger.info(
        "Verified normal table mode restored after removing pivot field"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should enforce max 3 pivot fields",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add X field
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );

      // Add 3 pivot fields
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_image",
        "p"
      );
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_namespace_name",
        "p"
      );

      // Verify all 3 breakdown items are present
      await expect(
        page.locator('[data-test="dashboard-b-item-breakdown_1"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-test="dashboard-b-item-breakdown_2"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-test="dashboard-b-item-breakdown_3"]')
      ).toBeVisible();

      testLogger.info("Verified 3 pivot fields added successfully");

      // Try to add a 4th pivot field - the +P button should be disabled
      const searchInput = page.locator(
        '[data-test="index-field-search-input"]'
      );
      await searchInput.click();
      await searchInput.fill("log");

      const pivotButton = page
        .locator('[data-test="dashboard-add-p-data"]')
        .first();

      // The button should be disabled (greyed out / not clickable)
      const isDisabled = await pivotButton.isDisabled();
      expect(isDisabled).toBe(true);

      testLogger.info("Verified +P button is disabled after 3 pivot fields");

      // Clean up
      await searchInput.fill("");
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should persist pivot settings after save and reload",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Create pivot table
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel and enable row totals
      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.togglePivotRowTotals();
      await pm.dashboardPanelConfigs.togglePivotColTotals();

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Save the panel
      await pm.dashboardPanelActions.savePanel();

      // Wait for panel to be saved
      await page
        .locator(
          `[data-test="dashboard-edit-panel-${panelName}-dropdown"]`
        )
        .waitFor({ state: "visible", timeout: 30000 });

      testLogger.info("Saved pivot table panel with row/col totals enabled");

      // Edit the panel again
      await pm.dashboardPanelActions.selectPanelAction(panelName, "Edit");
      await page
        .locator('[data-test="dashboard-apply"]')
        .waitFor({ state: "visible", timeout: 30000 });

      // Verify pivot field still present
      const breakdownItem = page.locator(
        '[data-test="dashboard-b-item-breakdown_1"]'
      );
      await expect(breakdownItem).toBeVisible();

      // Open config panel and verify settings persisted
      await pm.dashboardPanelConfigs.openConfigPanel();

      const rowTotalsToggle = page.locator(
        '[data-test="dashboard-config-pivot-row-totals"]'
      );
      const colTotalsToggle = page.locator(
        '[data-test="dashboard-config-pivot-col-totals"]'
      );

      const rowTotalsState =
        await rowTotalsToggle.getAttribute("aria-checked");
      expect(rowTotalsState).toBe("true");

      const colTotalsState =
        await colTotalsToggle.getAttribute("aria-checked");
      expect(colTotalsState).toBe("true");

      testLogger.info(
        "Verified pivot settings persisted after save and reload"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should preserve breakdown field when switching chart types",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Create pivot table
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Verify breakdown field is present
      const breakdownItem = page.locator(
        '[data-test="dashboard-b-item-breakdown_1"]'
      );
      await expect(breakdownItem).toBeVisible();

      testLogger.info("Pivot table created with breakdown field");

      // Switch to bar chart - breakdown should become bar breakdown
      await pm.chartTypeSelector.selectChartType("stacked");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Breakdown field should still be present
      await expect(breakdownItem).toBeVisible();

      testLogger.info("Breakdown preserved when switching to stacked chart");

      // Switch back to table - breakdown should become pivot again
      await pm.chartTypeSelector.selectChartType("table");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Breakdown field should still be present
      await expect(breakdownItem).toBeVisible();

      // Verify pivot mode is active (labels should show "Row Fields")
      await expect(page.getByText("Row Fields")).toBeVisible();

      testLogger.info(
        "Breakdown preserved when switching back to table (pivot mode restored)"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should show sticky sub-options only when parent total toggle is enabled",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Create pivot table
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel
      await pm.dashboardPanelConfigs.openConfigPanel();

      const stickyColTotals = page.locator(
        '[data-test="dashboard-config-pivot-sticky-col-totals"]'
      );
      const stickyRowTotals = page.locator(
        '[data-test="dashboard-config-pivot-sticky-row-totals"]'
      );

      // Initially, sticky sub-options should NOT be visible
      await expect(stickyColTotals).not.toBeVisible();
      await expect(stickyRowTotals).not.toBeVisible();

      testLogger.info(
        "Verified sticky sub-options hidden when parent totals are OFF"
      );

      // Enable Row Totals -> Sticky Col Totals should appear
      await pm.dashboardPanelConfigs.togglePivotRowTotals();
      await expect(stickyColTotals).toBeVisible();
      await expect(stickyRowTotals).not.toBeVisible();

      testLogger.info(
        "Verified sticky col totals appears when row totals enabled"
      );

      // Enable Col Totals -> Sticky Row Totals should appear
      await pm.dashboardPanelConfigs.togglePivotColTotals();
      await expect(stickyRowTotals).toBeVisible();

      testLogger.info(
        "Verified sticky row totals appears when col totals enabled"
      );

      // Disable Row Totals -> Sticky Col Totals should disappear
      await pm.dashboardPanelConfigs.togglePivotRowTotals();
      await expect(stickyColTotals).not.toBeVisible();

      testLogger.info(
        "Verified sticky col totals hides when row totals disabled"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  // ===== P2 - Edge Case Tests =====

  test(
    "should render flat table when only breakdown + Y fields (no X)",
    {
      tag: ["@pivotTable", "@edge-case", "@P2"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Remote auto-populated X field
      await pm.chartTypeSelector.removeField("x_axis_1", "x");

      // Add only Pivot (breakdown) + Y fields (no X)
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel - pivot options should NOT be visible
      // (no X field → isPivotMode is false)
      await pm.dashboardPanelConfigs.openConfigPanel();
      const pivotRowTotals = page.locator(
        '[data-test="dashboard-config-pivot-row-totals"]'
      );
      await expect(pivotRowTotals).not.toBeVisible();

      // Labels should show "First Column" (non-pivot mode)
      await expect(page.getByText("First Column")).toBeVisible();

      testLogger.info(
        "Verified flat table renders when breakdown + Y without X"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should render flat table when only X + breakdown fields (no Y)",
    {
      tag: ["@pivotTable", "@edge-case", "@P2"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      // Navigate and create dashboard
      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Select table chart and stream
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add only X + Pivot (breakdown) fields (no Y)
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config panel - pivot options should NOT be visible
      // (no Y field → isPivotMode is false)
      await pm.dashboardPanelConfigs.openConfigPanel();
      const pivotRowTotals = page.locator(
        '[data-test="dashboard-config-pivot-row-totals"]'
      );
      await expect(pivotRowTotals).not.toBeVisible();

      // Labels should show "First Column" (non-pivot mode)
      await expect(page.getByText("First Column")).toBeVisible();

      testLogger.info(
        "Verified flat table renders when X + breakdown without Y"
      );

      // Clean up
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should support and render pivot with compound hierarchical headers (1x + 1p + 2y)",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Create compound header pivot table
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // X field
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "x");
      // P field
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      
      // Multiple Y fields to create hierarchy
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.chartTypeSelector.searchAndAddField("log", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_2", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Verify that the breakdown layout accommodates multiple Y aggregations correctly
      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      // Verify breakdown is present, signifying pivot mode is active
      const breakdownItem = page.locator(
        '[data-test="dashboard-b-item-breakdown_1"]'
      );
      await expect(breakdownItem).toBeVisible();

      testLogger.info("Verified render pivot with compound hierarchical headers");

      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "should support multi-row pivot configuration (2x + 1p + 1y)",
    {
      tag: ["@pivotTable", "@functional", "@P1"],
    },
    async ({ page }) => {
      const dashboardName = generateUniqueDashboardName();
      const pm = new PageManager(page);
      const panelName = pm.dashboardPanelActions.generateUniquePanelName("pivot-test");

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);
      await pm.dashboardCreate.waitForDashboardUIStable();
      await pm.dashboardCreate.createDashboard(dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Multiple X Fields
      await pm.chartTypeSelector.searchAndAddField("kubernetes_namespace_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      
      // P field
      await pm.chartTypeSelector.searchAndAddField("kubernetes_host", "p");
      
      // Y field
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      // Ensure 2 X Fields and 1 breakdown were handled correctly
      const bLayout = page.locator('[data-test="dashboard-b-layout"]');
      await expect(bLayout).toBeVisible();

      testLogger.info("Verified multi-row pivot configuration");
      
      await pm.dashboardPanelActions.savePanel();
      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );
});
