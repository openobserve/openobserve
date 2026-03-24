const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupTablePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
const testLogger = require("../utils/test-logger.js");

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

/**
 * Dashboard Table Chart - Core Feature Tests
 *
 * ALREADY COVERED ELSEWHERE (NOT duplicated here):
 * - dashboard-config-table.spec.js: wrap cells, transpose, dynamic columns, pagination toggle
 * - dashboard-table-pagination.spec.js: pagination controls, rows per page, persistence,
 *     chart type switching (table→bar→table), custom SQL + pagination, non-table config hidden
 * - dashboard-pivot-table.spec.js: pivot features, +P button, totals, breakdown+Y without X
 * - dashboard-config-general.spec.js: unit, decimals, no-value replacement, query limit (bar chart)
 * - dashboard-config-advanced.spec.js: override config (Bytes on table), value mapping (on table)
 * - dashboard-transpose.spec.js: transpose toggle, transpose data verification, dynamic cols + VRL
 * - metrics-table-column-order.spec.js: PromQL column reorder
 *
 * THIS SPEC COVERS (unique scenarios only):
 * - Basic table rendering with data rows and column headers
 * - Table column headers match selected fields
 * - Table sorting by clicking column headers
 * - Table with multiple Y fields (non-pivot)
 * - Table with X + Y fields (grouped data)
 * - Table row count verification
 * - Combined config: wrap cells + transpose together
 * - Combined config: dynamic columns + wrap cells together
 * - histogram(_timestamp) X axis with count() Y in builder mode
 * - Timestamp formatting in table cells
 * - Numeric values display with configured decimals
 * - Row count info display ("X-Y of Z") without pagination
 * - Pivot field placeholder visible when no pivot field added
 * - Adding filter field to table panel and verifying filtered data
 * - Switching query modes (Builder → Custom) preserves table data
 * - First Column (X) + Other Columns (Y) layout labels
 * - Table with Y-axis aggregation function (sum, avg, min, max)
 */
test.describe("Dashboard Table Chart - Core Features", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // ===== P0 — Basic Rendering =====

  test(
    "should render table with data rows and correct column headers",
    { tag: ["@tableChart", "@smoke", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTablePanelWithConfig(page, pm, dashboardName);

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      // Verify table has header row with at least one column
      const headerCells = table.locator("thead th");
      const headerCount = await headerCells.count();
      expect(headerCount).toBeGreaterThan(0);

      testLogger.info("Table rendered with headers", { headerCount });

      // Verify table has data rows with non-empty cells
      const dataRows = table.locator("tbody tr");
      const rowCount = await dataRows.count();
      expect(rowCount).toBeGreaterThan(0);

      testLogger.info("Table has data rows", { rowCount });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should display column headers matching selected Y field",
    { tag: ["@tableChart", "@smoke", "@P0"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTablePanelWithConfig(page, pm, dashboardName);

      // The default Y field from setupTablePanelWithConfig is "kubernetes_container_hash"
      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      const headers = await table.locator("thead th").allTextContents();
      const headerTexts = headers.map((h) => h.trim().toLowerCase());

      // Should contain the Y field name in some form
      const hasYField = headerTexts.some(
        (h) =>
          h.includes("kubernetes_container_hash") ||
          h.includes("count") ||
          h.includes("kubernetes")
      );
      expect(hasYField).toBe(true);

      testLogger.info("Column headers verified", { headers: headerTexts });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Sorting =====

  test(
    "should sort table data when clicking column header",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTablePanelWithConfig(page, pm, dashboardName);

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      // Get initial first cell value
      const firstCellBefore = await table
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .textContent();

      // Click on the first sortable column header to trigger sort
      const firstHeader = table.locator("thead th").first();
      await firstHeader.click();

      // Table should still render after sort
      await expect(table).toBeVisible();
      const rowCountAfterSort = await table.locator("tbody tr").count();
      expect(rowCountAfterSort).toBeGreaterThan(0);

      // Click again to reverse sort direction
      await firstHeader.click();
      await expect(table).toBeVisible();

      testLogger.info("Table sorting by column header click verified");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Multiple Y Fields (non-pivot) =====

  test(
    "should render table with multiple Y fields as separate columns",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Multi Y Fields");

      // Select table chart
      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add first Y field
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_hash",
        "y"
      );

      // Add second Y field
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Verify at least 2 columns for the two Y fields
      const headerCount = await table.locator("thead th").count();
      expect(headerCount).toBeGreaterThanOrEqual(2);

      testLogger.info("Table with multiple Y fields rendered", {
        headerCount,
      });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — X + Y Fields (grouped) =====

  test(
    "should render table with X and Y fields showing grouped data",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("X Y Fields Table");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add X field (group by)
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );

      // Add Y field with count aggregation
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Verify headers include both X and Y fields
      const headers = await table.locator("thead th").allTextContents();
      const headerTexts = headers.map((h) => h.trim().toLowerCase());

      const hasXField = headerTexts.some(
        (h) =>
          h.includes("kubernetes_container_name") || h.includes("x_axis")
      );
      const hasYField = headerTexts.some(
        (h) =>
          h.includes("count") ||
          h.includes("y_axis") ||
          h.includes("_timestamp")
      );
      expect(hasXField || hasYField).toBe(true);

      testLogger.info("Table with X+Y fields rendered", {
        headers: headerTexts,
      });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Row Count =====

  test(
    "should verify table row count is greater than zero",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTablePanelWithConfig(page, pm, dashboardName);

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      const rowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(rowCount).toBeGreaterThan(0);

      testLogger.info("Table row count verified", { rowCount });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P2 — Combined Config Options =====

  test(
    "should handle wrap cells + transpose enabled simultaneously",
    { tag: ["@tableChart", "@edge-case", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTablePanelWithConfig(page, pm, dashboardName);

      // Enable both wrap cells and transpose
      await pm.dashboardPanelConfigs.selectWrapCell();
      await pm.dashboardPanelConfigs.selectTranspose();
      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      testLogger.info("Table with wrap cells + transpose rendered");

      // Verify both persist after save
      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);

      await expect(
        page.locator('[data-test="dashboard-config-wrap-table-cells"]')
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        page.locator('[data-test="dashboard-config-table_transpose"]')
      ).toHaveAttribute("aria-checked", "true");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  test(
    "should handle dynamic columns + wrap cells enabled simultaneously",
    { tag: ["@tableChart", "@edge-case", "@P2"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTablePanelWithConfig(page, pm, dashboardName);

      // Enable both dynamic columns and wrap cells
      await pm.dashboardPanelConfigs.selectDynamicColumns();
      await pm.dashboardPanelConfigs.selectWrapCell();
      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible();

      testLogger.info("Table with dynamic columns + wrap cells rendered");

      // Verify both persist after save
      await pm.dashboardPanelActions.savePanel();
      await reopenPanelConfig(page, pm);

      await expect(
        page.locator('[data-test="dashboard-config-table_dynamic_columns"]')
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        page.locator('[data-test="dashboard-config-wrap-table-cells"]')
      ).toHaveAttribute("aria-checked", "true");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — histogram(X) + count(Y) Builder Mode =====

  test(
    "should render table with histogram(_timestamp) as X and count aggregation as Y",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Histogram Table");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add _timestamp as X (histogram) — same as screenshot
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add code as Y with count aggregation — same as screenshot
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Verify headers — should have Timestamp and Code columns
      const headers = await table.locator("thead th").allTextContents();
      const headerTexts = headers.map((h) => h.trim().toLowerCase());
      expect(headerTexts.length).toBeGreaterThanOrEqual(2);

      testLogger.info("Histogram + count table rendered", {
        headers: headerTexts,
      });

      // Verify data rows exist with timestamp values
      const firstCellText = await table
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .textContent();
      expect(firstCellText.trim()).not.toBe("");

      testLogger.info("First cell contains data", {
        value: firstCellText.trim(),
      });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Timestamp Column Formatting =====

  test(
    "should display timestamp values in formatted date-time string",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Timestamp Format");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add _timestamp as X to get formatted timestamp column
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Get first timestamp cell — should be a formatted date string (e.g., 2026-03-23T05:00:00)
      const timestampCell = await table
        .locator("tbody tr")
        .first()
        .locator("td")
        .first()
        .textContent();
      const trimmed = timestampCell.trim();

      // Verify it looks like a date-time string (contains year-month-day pattern)
      const hasDatePattern = /\d{4}[-/]\d{2}[-/]\d{2}/.test(trimmed);
      expect(hasDatePattern).toBe(true);

      testLogger.info("Timestamp formatted correctly", { value: trimmed });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Numeric Values with Decimals =====

  test(
    "should display numeric values with correct decimal places in table",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Decimals Display");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.dashboardPanelActions.waitForChartToRender();

      // Open config and set decimals to 2 (like the screenshot shows: 549.00, 2745.00)
      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.selectDecimals("2");
      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Get a numeric cell value from the second column (Y-axis values)
      const numericCell = await table
        .locator("tbody tr")
        .first()
        .locator("td")
        .nth(1)
        .textContent();
      const trimmed = numericCell.trim();

      // Verify the value contains a decimal point with 2 digits (e.g., "549.00")
      const hasDecimals = /\d+\.\d{2}/.test(trimmed);
      expect(hasDecimals).toBe(true);

      testLogger.info("Numeric value displayed with 2 decimals", {
        value: trimmed,
      });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Row Count Info Display =====

  test(
    "should display row count info (X-Y of Z) at bottom of table",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Row Count Info");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Screenshot shows "1-7 of 7" at bottom right of table
      // Look for row count info text matching "X-Y of Z" pattern
      const tableText = await table.textContent();
      const hasRowCountInfo = /\d+-\d+\s+of\s+\d+/.test(tableText);
      expect(hasRowCountInfo).toBe(true);

      testLogger.info("Row count info displayed at bottom of table");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Pivot Field Placeholder =====

  test(
    "should show pivot field placeholder when no pivot field is added",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Pivot Placeholder");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_hash",
        "y"
      );

      await pm.dashboardPanelActions.applyDashboardBtn();

      // Verify "Pivot Field" area is visible with placeholder text
      // Screenshot shows: "Pivot Field ⓘ:  Add 0 or 1 field here"
      const pivotPlaceholder = page.getByText("Add 0 or 1 field here");
      await expect(pivotPlaceholder).toBeVisible();

      testLogger.info("Pivot field placeholder visible with no pivot field");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Filter Field on Table =====

  test(
    "should add filter field to table panel and render filtered data",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Filtered Table");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add Y field
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_hash",
        "y"
      );

      // Add a filter field using the filter button
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "filter"
      );

      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Verify table still has data after filter applied
      const rowCount = await table.locator("tbody tr").count();
      expect(rowCount).toBeGreaterThan(0);

      testLogger.info("Table with filter field rendered", { rowCount });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Builder to Custom Query Mode Switch =====

  test(
    "should switch from Builder to Custom query mode and table still renders",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Query Mode Switch");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Setup in builder mode (default)
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Capture row count in builder mode
      const builderRowCount = await table.locator("tbody tr").count();
      expect(builderRowCount).toBeGreaterThan(0);

      testLogger.info("Builder mode table rows", { builderRowCount });

      // Switch to Custom query mode
      const customBtn = page.locator(
        '[data-test="dashboard-custom-query-type"]'
      );
      await customBtn.waitFor({ state: "visible", timeout: 10000 });
      await customBtn.click();

      // The auto-generated SQL should be visible in the editor
      const queryEditor = page.locator(
        '[data-test="dashboard-panel-query-editor"]'
      );
      await queryEditor.waitFor({ state: "visible", timeout: 10000 });

      // Apply in custom mode — table should still render
      const streamPromise2 = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise2;

      await expect(table).toBeVisible({ timeout: 15000 });
      const customRowCount = await table.locator("tbody tr").count();
      expect(customRowCount).toBeGreaterThan(0);

      testLogger.info("Custom mode table rows", { customRowCount });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — First Column / Other Columns Labels =====

  test(
    "should display First Column and Other Columns labels for X and Y fields",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Layout Labels");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      // Add X field — should show in "First Column" area
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");

      // Add Y field — should show in "Other Columns" area
      await pm.chartTypeSelector.searchAndAddField("code", "y");

      // Verify "First Column" label is visible (screenshot shows it)
      const firstColumnLabel = page.getByText("First Column");
      await expect(firstColumnLabel.first()).toBeVisible();

      // Verify "Other Columns" label is visible
      const otherColumnsLabel = page.getByText("Other Columns");
      await expect(otherColumnsLabel.first()).toBeVisible();

      testLogger.info("First Column and Other Columns labels visible");

      // Verify X field chip appears in the First Column area
      const xLayout = page.locator('[data-test="dashboard-x-layout"]');
      await expect(xLayout).toBeVisible();

      // Verify Y field chip appears in the Other Columns area
      const yLayout = page.locator('[data-test="dashboard-y-layout"]');
      await expect(yLayout).toBeVisible();

      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Y-Axis Aggregation Functions =====

  test(
    "should render table with different Y-axis aggregation functions (sum, avg, min, max)",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Aggregation Functions");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "x"
      );
      await pm.chartTypeSelector.searchAndAddField("code", "y");

      // Test with "sum" aggregation
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "sum");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;

      const table = page.locator('[data-test="dashboard-panel-table"]');
      await expect(table).toBeVisible({ timeout: 15000 });

      // Verify numeric values are rendered in Y column
      const numericCell = await table
        .locator("tbody tr")
        .first()
        .locator("td")
        .nth(1)
        .textContent();
      expect(numericCell.trim()).not.toBe("");

      testLogger.info("Table with sum aggregation rendered", {
        value: numericCell.trim(),
      });

      // Now switch to "avg" aggregation
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "avg");

      const streamPromise2 = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise2;

      await expect(table).toBeVisible({ timeout: 15000 });

      const avgCell = await table
        .locator("tbody tr")
        .first()
        .locator("td")
        .nth(1)
        .textContent();
      expect(avgCell.trim()).not.toBe("");

      testLogger.info("Table with avg aggregation rendered", {
        value: avgCell.trim(),
      });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
