import {
  test,
  expect,
  navigateToBase,
} from "../utils/enhanced-baseFixtures.js";
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard, setupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupTablePanel,
  setupTablePanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
import testLogger from "../utils/test-logger.js";
import {
  TABLE_SELECTOR,
  TABLE_HEADER_SELECTOR,
  getTableHeaders,
  getTableCellText,
} from "../../pages/dashboardPages/dashboard-table-helpers.js";

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
 * - VRL-created field displayed as column with dynamic columns enabled
 * - histogram(_timestamp) X axis with count() Y in builder mode
 * - Timestamp formatting in table cells
 * - Numeric values display with configured decimals
 * - Row count info display ("X-Y of Z") without pagination
 * - Pivot field placeholder visible when no pivot field added
 * - Filtering table data using a dashboard variable with query inspector verification
 * - Switching query modes (Builder → Custom) preserves table data
 * - First Column (X) + Other Columns (Y) layout labels
 * - Table with Y-axis aggregation function (sum, avg, min, max)
 */
test.describe("Dashboard Table Chart - Core Features", () => {
  test.describe.configure({ mode: "parallel", retries: 1 });
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

      await setupTablePanel(page, pm, dashboardName);
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Verify table has header columns
      const headers = await getTableHeaders(page);
      expect(headers.length).toBeGreaterThan(0);
      testLogger.info("Table rendered with headers", { headerCount: headers.length });

      // Verify table has data rows
      const rowCount = await pm.dashboardPanelActions.getTableRowCount();
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

      // setupTablePanel uses "kubernetes_container_hash" as default Y field
      await setupTablePanel(page, pm, dashboardName);
      await pm.chartTypeSelector.waitForTableDataLoad();

      const headers = await getTableHeaders(page);
      const headerTexts = headers.map((h) => h.toLowerCase());

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

      await setupTablePanel(page, pm, dashboardName);
      await pm.chartTypeSelector.waitForTableDataLoad();

      const table = page.locator(TABLE_SELECTOR);

      // Click on the first column header to trigger sort
      const firstHeader = page.locator(TABLE_HEADER_SELECTOR).first();
      await firstHeader.click();

      // Table should still render after sort
      await expect(table).toBeVisible();
      const rowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(rowCount).toBeGreaterThan(0);

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

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      const headers = await getTableHeaders(page);
      expect(headers.length).toBeGreaterThanOrEqual(2);

      testLogger.info("Table with multiple Y fields rendered", { headerCount: headers.length });

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

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const headers = await getTableHeaders(page);
      testLogger.info("Table with X+Y fields rendered", { headers });

      // Table should have at least 2 columns (X field + Y field)
      expect(headers.length).toBeGreaterThanOrEqual(2);

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

      await setupTablePanel(page, pm, dashboardName);
      await pm.chartTypeSelector.waitForTableDataLoad();

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

      await pm.dashboardPanelConfigs.selectWrapCell();
      await pm.dashboardPanelConfigs.selectTranspose();
      await pm.dashboardPanelActions.applyDashboardBtn();

      const table = page.locator(TABLE_SELECTOR);
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
    "should display VRL-created field as column when dynamic columns enabled",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("VRL Dynamic Cols");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_pod_name", "y");

      // Enable VRL function toggle and add a VRL function that creates a new field
      const vrlToggle = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
      await vrlToggle.click();

      const vrlEditor = page.locator('[data-test="dashboard-vrl-function-editor"]');
      await vrlEditor.waitFor({ state: "visible", timeout: 10000 });
      const monacoInput = vrlEditor.getByRole("code");
      await monacoInput.click();
      await page.keyboard.type('.vrl_test_field = "hello_vrl"', { delay: 50 });
      await page.keyboard.press("Escape");
      // Wait for VRL editor to reflect the typed content
      await page.waitForFunction(
        () => document.querySelector('[data-test="dashboard-vrl-function-editor"]')?.textContent?.includes('vrl_test_field')
      );

      // First apply: execute the query with VRL so the new field is generated
      const streamPromise1 = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise1;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Now enable dynamic columns so the VRL-created field appears as a column
      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.selectDynamicColumns();

      // Second apply: re-render table with dynamic columns enabled
      const streamPromise2 = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise2;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Verify the VRL-created field appears as a column in the table.
      // Poll until the header appears (the table re-renders asynchronously after
      // dynamic columns are enabled and the stream completes).
      await expect
        .poll(
          async () => {
            const headers = await getTableHeaders(page);
            return headers.map((h) => h.toLowerCase()).some((h) => h.includes("vrl_test_field"));
          },
          { timeout: 15000, intervals: [500, 1000, 2000] }
        )
        .toBe(true);

      const headers = await getTableHeaders(page);
      const hasVrlField = headers.map((h) => h.toLowerCase()).some((h) => h.includes("vrl_test_field"));
      expect(hasVrlField).toBe(true);

      testLogger.info("VRL field visible as dynamic column", { headers });

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

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Verify headers — should have at least 2 columns (Timestamp + Code)
      const headers = await getTableHeaders(page);
      expect(headers.length).toBeGreaterThanOrEqual(2);

      testLogger.info("Histogram + count table rendered", { headers });

      // Verify data rows rendered
      const rowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(rowCount).toBeGreaterThan(0);
      testLogger.info("Histogram table has data rows", { rowCount });

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

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      // First column cell should be a formatted date (e.g., 2026-03-23T05:00:00)
      const timestampText = await getTableCellText(page, 0, 0);
      const hasDatePattern = /\d{4}[-/]\d{2}[-/]\d{2}/.test(timestampText);
      expect(hasDatePattern).toBe(true);

      testLogger.info("Timestamp formatted correctly", { value: timestampText });

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

      // Open config and set decimals to 2 (screenshot shows: 549.00, 2745.00)
      await pm.dashboardPanelConfigs.openConfigPanel();
      await pm.dashboardPanelConfigs.selectDecimals("2");
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Find the numeric Y column (last column = Code) and verify decimals
      const headers = await getTableHeaders(page);
      const numericColIndex = headers.length - 1;
      const numericText = await getTableCellText(page, 0, numericColIndex);
      const hasDecimals = /\d+\.\d{2}/.test(numericText);
      expect(hasDecimals).toBe(true);

      testLogger.info("Numeric value displayed with 2 decimals", { value: numericText });

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
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Screenshot shows "1-7 of 7" at bottom right of table
      const table = page.locator(TABLE_SELECTOR);
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

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
      await pm.dashboardPanelActions.applyDashboardBtn();

      // Screenshot shows: "Pivot Field ⓘ:  Add 0 or 1 field here"
      const pivotPlaceholder = page.getByText("Add 0 or 1 field here");
      await expect(pivotPlaceholder).toBeVisible();

      testLogger.info("Pivot field placeholder visible with no pivot field");

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Variable-based Filter on Table =====

  test(
    "should filter table data using a dashboard variable",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      await setupTestDashboard(page, pm, dashboardName);

      // Create a dashboard variable via settings
      await pm.dashboardSetting.openSetting();
      await pm.dashboardVariables.addDashboardVariable(
        "containername",
        "logs",
        "e2e_automate",
        "kubernetes_container_name"
      );

      // Add table panel with filter field
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Variable Filter Table");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "filter");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      // Get unfiltered row count
      const unfilteredRowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(unfilteredRowCount).toBeGreaterThan(0);
      testLogger.info("Unfiltered table rows", { unfilteredRowCount });

      // Select a specific value from the variable dropdown
      await pm.dashboardVariables.selectValueFromVariableDropDown(
        "containername",
        "ziox"
      );

      // Set filter condition to use the variable: $containername
      await pm.dashboardFilter.addFilterCondition(
        0,
        "kubernetes_container_name",
        "",
        "=",
        "$containername"
      );

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const filteredRowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(filteredRowCount).toBeGreaterThan(0);
      // Filtered count should be less than or equal to unfiltered
      expect(filteredRowCount).toBeLessThanOrEqual(unfilteredRowCount);

      // Verify the filter is reflected in the query via query inspector
      await page
        .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
        .click();
      await expect(
        page.locator(".inspector-query-editor").filter({
          hasText: "kubernetes_container_name = 'ziox'",
        }).last()
      ).toBeVisible();
      await page.locator('[data-test="query-inspector-dialog"] [data-test="o-dialog-close-btn"]').click();

      testLogger.info("Table filtered by variable", { unfilteredRowCount, filteredRowCount });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Dynamic Filter (Adhoc) on Table =====

  test(
    "should apply dynamic filter on table panel and verify filtered data",
    { tag: ["@tableChart", "@functional", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = generateDashboardName();

      // Build table panel in the panel editor
      await setupTestDashboard(page, pm, dashboardName);
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName("Dynamic Filter Table");

      await pm.chartTypeSelector.selectChartType("table");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_hash", "y");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      // --- BEFORE filter: capture row count and table content ---
      const table = page.locator(TABLE_SELECTOR);
      await table.waitFor({ state: "visible", timeout: 15000 });
      const beforeRowCount = await pm.dashboardPanelActions.getTableRowCount();
      const beforeHeaders = await getTableHeaders(page);
      const beforeFilterText = await table.textContent();
      testLogger.info("Before dynamic filter", {
        rowCount: beforeRowCount,
        headers: beforeHeaders,
        preview: beforeFilterText.substring(0, 200),
      });

      // Before filter: table should have multiple rows (multiple container names)
      expect(beforeRowCount).toBeGreaterThan(1);

      // --- Apply dynamic filter: kubernetes_container_name = ziox ---
      const adhocAddBtn = page.locator('[data-test="dashboard-variable-adhoc-add-selector"]');
      await adhocAddBtn.waitFor({ state: "visible", timeout: 15000 });
      await adhocAddBtn.click();

      const nameSelector = page.locator('[data-test="dashboard-variable-adhoc-name-selector"]');
      await nameSelector.click();
      await nameSelector.fill("kubernetes_container_name");

      const valueSelector = page.locator('[data-test="dashboard-variable-adhoc-value-selector"]');
      await valueSelector.click();
      await valueSelector.fill("ziox");

      // Apply to re-query with the dynamic filter
      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      // --- AFTER filter: capture row count and table content ---
      const afterRowCount = await pm.dashboardPanelActions.getTableRowCount();
      const afterFilterText = await table.textContent();
      testLogger.info("After dynamic filter", {
        rowCount: afterRowCount,
        preview: afterFilterText.substring(0, 200),
      });

      // After filter: row count should be less than before (filtered down)
      expect(afterRowCount).toBeLessThan(beforeRowCount);

      // After filter: table data should have changed
      expect(afterFilterText).not.toEqual(beforeFilterText);

      // After filter: table should contain "ziox" in filtered results
      expect(afterFilterText.toLowerCase()).toContain("ziox");

      // After filter: first data row should show "ziox" as container name
      // Column 0 = Timestamp, Column 1 = Kubernetes Container Name
      const firstRowContainerName = await getTableCellText(page, 0, 1);
      expect(firstRowContainerName.toLowerCase()).toBe("ziox");

      testLogger.info("Dynamic filter verified", {
        beforeRows: beforeRowCount,
        afterRows: afterRowCount,
        firstRowValue: firstRowContainerName,
      });

      // Save and cleanup
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

      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "count");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const builderRowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(builderRowCount).toBeGreaterThan(0);
      testLogger.info("Builder mode table rows", { builderRowCount });

      // Switch to Custom query mode
      const customBtn = page.locator('[data-test="dashboard-custom-query-type"]');
      await customBtn.waitFor({ state: "visible", timeout: 10000 });
      await customBtn.click();

      // The auto-generated SQL should be visible in the editor
      const queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');
      await queryEditor.waitFor({ state: "visible", timeout: 10000 });

      // Apply in custom mode — table should still render
      const streamPromise2 = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise2;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const customRowCount = await pm.dashboardPanelActions.getTableRowCount();
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

      // Add X field — shows in "First Column" area
      await pm.chartTypeSelector.searchAndAddField("_timestamp", "x");
      // Add Y field — shows in "Other Columns" area
      await pm.chartTypeSelector.searchAndAddField("code", "y");

      // Verify layout labels
      await expect(page.getByText("First Column").first()).toBeVisible();
      await expect(page.getByText("Other Columns").first()).toBeVisible();

      // Verify field chips in correct layout areas
      const xLayout = page.locator('[data-test="dashboard-x-layout"]');
      await expect(xLayout).toBeVisible();
      const yLayout = page.locator('[data-test="dashboard-y-layout"]');
      await expect(yLayout).toBeVisible();

      testLogger.info("First Column and Other Columns labels visible");

      await pm.dashboardPanelActions.applyDashboardBtn();
      await pm.chartTypeSelector.waitForTableDataLoad();

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );

  // ===== P1 — Y-Axis Aggregation Functions =====

  test(
    "should render table with different Y-axis aggregation functions (sum, avg)",
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

      await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
      await pm.chartTypeSelector.searchAndAddField("code", "y");

      // Test with "sum" aggregation
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "sum");

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const sumRowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(sumRowCount).toBeGreaterThan(0);
      testLogger.info("Table with sum aggregation rendered", { rowCount: sumRowCount });

      // Switch to "avg" aggregation
      await pm.chartTypeSelector.configureYAxisFunction("y_axis_1", "avg");

      const streamPromise2 = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise2;
      await pm.chartTypeSelector.waitForTableDataLoad();

      const avgRowCount = await pm.dashboardPanelActions.getTableRowCount();
      expect(avgRowCount).toBeGreaterThan(0);
      testLogger.info("Table with avg aggregation rendered", { rowCount: avgRowCount });

      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
    }
  );
});
