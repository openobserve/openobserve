const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupPromQLPanelWithConfig,
  setupPromQLMetricPanelWithConfig,
  setupPromQLPiePanelWithConfig,
  setupPromQLDonutPanelWithConfig,
  setupPromQLTablePanelWithConfig,
  setupPromQLGeomapPanelWithConfig,
  setupPromQLMapsPanelWithConfig,
  reopenPanelConfig,
  waitForPanelRenderSettled,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — PromQL Settings", () => {
  // Ensure metrics are ingested once before all tests run
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
  });

  test("step value: visible in PromQL mode → set to 5m → apply → chart renders; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const stepValueInput = pm.dashboardPanelConfigs.stepValue;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stepValueInput);
    await expect(stepValueInput).toBeVisible();

    // Clear and set step value to 5m
    await stepValueInput.locator('[data-test$="-field"]').fill("5m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Step value set to 5m");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    // Save and verify persistence
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying step value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.stepValue.locator('[data-test$="-field"]')).toHaveValue("5m");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("PromQL legend info: visible in PromQL mode → renders without errors", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const legendInfo = pm.dashboardPanelConfigs.promqlLegendInfo;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInfo);
    await expect(legendInfo).toBeVisible();
    testLogger.info("PromQL legend info icon is visible in PromQL mode");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("aggregation function: visible for PromQL pie → change to Max → apply; change to Avg → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPiePanelWithConfig(page, pm, dashboardName);

    const aggregationDropdown = pm.dashboardPanelConfigs.aggregation;
    await expect(aggregationDropdown).toBeVisible();

    // Change aggregation to Max — full option label is "Max (maximum value)"
    await aggregationDropdown.click();
    await pm.dashboardPanelConfigs.getAggregationOption("Max (maximum value)").click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Max");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    // Change aggregation to Avg — full option label is "Avg (average)"
    await aggregationDropdown.click();
    await pm.dashboardPanelConfigs.getAggregationOption("Avg (average)").click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Avg");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying aggregation Avg persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.aggregation).toContainText("Avg");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("PromQL table mode: visible for PromQL table → switch to Expanded Time series → apply; switch to Aggregate → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    const tableModeDropdown = pm.dashboardPanelConfigs.promqlTableMode;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await expect(tableModeDropdown).toBeVisible();

    // Switch to "Expanded Time series"
    await pm.dashboardPanelConfigs.promqlTableModeTrigger.click();
    const expandedOption = pm.dashboardPanelConfigs.getPromqlTableModeOption("Expanded Time series");
    await expandedOption.waitFor({ state: "visible" });
    await expandedOption.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("PromQL table mode set to Expanded Time series");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    // Switch to "Aggregate"
    await pm.dashboardPanelConfigs.promqlTableModeTrigger.click();
    const aggregateOption = pm.dashboardPanelConfigs.getPromqlTableModeOption("Aggregate");
    await aggregateOption.waitFor({ state: "visible" });
    await aggregateOption.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("PromQL table mode set to Aggregate");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying PromQL table mode 'Aggregate' persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.scrollSidebarToElement(
      pm.dashboardPanelConfigs.promqlTableMode
    );
    await expect(pm.dashboardPanelConfigs.promqlTableMode).toContainText("Aggregate");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky first column: PromQL table (Aggregate mode) → enable toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    // Sticky first column only appears when promql_table_mode is 'all' or 'expanded_timeseries'
    // Switch to "Aggregate" mode first to reveal the sticky column controls
    const tableModeDropdown = pm.dashboardPanelConfigs.promqlTableMode;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await tableModeDropdown.click();
    await pm.dashboardPanelConfigs.getPromqlTableModeOption("Aggregate").click();
    testLogger.info("Table mode set to Aggregate — sticky column controls now visible");

    const stickyFirstCol = pm.dashboardPanelConfigs.stickyFirstColumn;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyFirstCol);
    await expect(stickyFirstCol).toBeVisible();

    // Enable the toggle (click to turn on)
    await stickyFirstCol.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Sticky first column enabled");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying sticky first column toggle persists after save");
    await reopenPanelConfig(page, pm);
    const toggle = pm.dashboardPanelConfigs.stickyFirstColumn;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggle);
    const ariaChecked = await toggle.locator('[data-test$="-btn"]').getAttribute("aria-checked");
    expect(ariaChecked).toBe("true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("connect null values: PromQL line chart → enable toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const connectNullToggle = pm.dashboardPanelConfigs.connectNullValuesToggle;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(connectNullToggle);
    await expect(connectNullToggle).toBeVisible();

    // Enable connect null values
    await connectNullToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Connect null values enabled");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying connect null values persists after save");
    await reopenPanelConfig(page, pm);
    const toggleAfter = pm.dashboardPanelConfigs.connectNullValuesToggle;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggleAfter);
    const ariaChecked = await toggleAfter.locator('[data-test$="-btn"]').getAttribute("aria-checked");
    expect(ariaChecked).toBe("true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("wrap table cells: PromQL table → enable wrap toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    const wrapToggle = pm.dashboardPanelConfigs.wrapcell;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(wrapToggle);
    await expect(wrapToggle).toBeVisible();

    await wrapToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Wrap table cells enabled");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying wrap table cells persists after save");
    await reopenPanelConfig(page, pm);
    const toggleAfter = pm.dashboardPanelConfigs.wrapcell;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggleAfter);
    const ariaChecked = await toggleAfter.locator('[data-test$="-btn"]').getAttribute("aria-checked");
    expect(ariaChecked).toBe("true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // Aggregate mode (promql_table_mode = 'all') — options only visible in this mode
  // ---------------------------------------------------------------------------

  /**
   * Switch the PromQL table to Aggregate mode and scroll to a target element.
   * Extracted to avoid repeating the same 4 steps in every Aggregate test.
   */
  async function switchToAggregateMode(page, pm) {
    const tableModeDropdown = pm.dashboardPanelConfigs.promqlTableMode;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    // Skip the switch if already in Aggregate mode — re-clicking the trigger then
    // the same option adds unnecessary UI interactions that increase flakiness risk.
    const triggerText = await pm.dashboardPanelConfigs.promqlTableModeTrigger.textContent();
    if (triggerText && triggerText.includes('Aggregate')) {
      testLogger.info("Table mode already in Aggregate — skipping switch");
      return;
    }
    await pm.dashboardPanelConfigs.promqlTableModeTrigger.click();
    // Use atomic waitForFunction click — virtualised list items can detach between
    // waitFor({state:'visible'}) and click(), causing intermittent "element detached" errors.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-test="dashboard-config-promql-table-mode-option"][data-test-label="Aggregate"]'
        );
        if (!el) return false;
        el.click();
        return true;
      },
      { timeout: 15000 }
    );
    // Wait for the dropdown to close before returning so callers can immediately
    // interact with Aggregate-mode-specific fields.
    await pm.dashboardPanelConfigs.getPromqlTableModeOption("Aggregate").waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    testLogger.info("Table mode switched to Aggregate");
  }

  test("table aggregations (Aggregate mode): dropdown visible → add Avg to default Last → apply; reopen → multi-selection persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const aggDropdown = pm.dashboardPanelConfigs.tableAggregations;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(aggDropdown);
    await expect(aggDropdown).toBeVisible();

    // Default is ["last"] — add "avg" to get ["last", "avg"]; display shows "last +1 more"
    await pm.dashboardPanelConfigs.tableAggregationsTrigger.click();
    const avgOption = pm.dashboardPanelConfigs.getTableAggregationsOption("Avg (average)");
    await avgOption.waitFor({ state: "visible" });
    await avgOption.click();
    await page.keyboard.press('Escape');
    testLogger.info("Table aggregations: added Avg (now last + avg)");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying table aggregations persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const aggAfter = pm.dashboardPanelConfigs.tableAggregations;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(aggAfter);
    await expect(aggAfter).toContainText("+1 more");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("visible columns (Aggregate mode): type custom column → chip added → apply; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const visibleColsInput = pm.dashboardPanelConfigs.visibleColumns;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(visibleColsInput);
    await expect(visibleColsInput).toBeVisible();

    // Open trigger → type the column name → ArrowDown + Enter
    // ArrowDown highlights the first matching option if the metric already has an
    // "instance" label (CI backend). When no options are present (creatable path),
    // ArrowDown is a no-op and Enter creates the value instead.
    await pm.dashboardPanelConfigs.visibleColumnsTrigger.click();
    const visibleSearchInput = pm.dashboardPanelConfigs.visibleColumnsSearch;
    await visibleSearchInput.waitFor({ state: "visible" });
    await visibleSearchInput.fill("instance");
    await page.keyboard.press("ArrowDown"); // highlight first match if dropdown has options
    await page.keyboard.press("Enter"); // select highlighted option, or create if none
    // Wait for the chip to appear before closing the dropdown — Enter is async (Vue
    // state update) and pressing Escape immediately can discard the chip in CI timing.
    await expect(visibleColsInput).toContainText("instance", { timeout: 5000 });
    await page.keyboard.press("Escape"); // close dropdown so it doesn't intercept Apply button
    testLogger.info("Visible column 'instance' added");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying visible columns persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const visibleAfterInput = pm.dashboardPanelConfigs.visibleColumns;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(visibleAfterInput);
    await expect(visibleAfterInput).toContainText("instance", { timeout: 10000 });
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("hidden columns (Aggregate mode): type custom column → chip added → apply; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const hiddenColsInput = pm.dashboardPanelConfigs.hiddenColumns;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(hiddenColsInput);
    await expect(hiddenColsInput).toBeVisible();

    await pm.dashboardPanelConfigs.hiddenColumnsTrigger.click();
    const hiddenSearchInput = pm.dashboardPanelConfigs.hiddenColumnsSearch;
    await hiddenSearchInput.waitFor({ state: "visible" });
    await hiddenSearchInput.fill("job");
    await page.keyboard.press("Enter"); // create the typed value (no stream fields in PromQL mode)
    // Wait for chip to appear before closing — prevents Enter/Escape race condition in CI.
    await expect(hiddenColsInput).toContainText("job", { timeout: 5000 });
    await page.keyboard.press("Escape"); // close dropdown so it doesn't intercept Apply button
    testLogger.info("Hidden column 'job' added");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying hidden columns persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const hiddenAfterInput = pm.dashboardPanelConfigs.hiddenColumns;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(hiddenAfterInput);
    await expect(hiddenAfterInput).toContainText("job", { timeout: 10000 });
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky columns (Aggregate mode): type custom column → chip added → apply; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    // Sticky columns multi-select is disabled when sticky_first_column=true — leave that toggle off
    const stickyColsInput = pm.dashboardPanelConfigs.stickyColumns;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsInput).toBeVisible();

    await pm.dashboardPanelConfigs.stickyColumnsTrigger.click();
    const stickySearchInput = pm.dashboardPanelConfigs.stickyColumnsSearch;
    await stickySearchInput.waitFor({ state: "visible" });
    await stickySearchInput.fill("instance");
    await page.keyboard.press("ArrowDown"); // highlight first match if dropdown has options
    await page.keyboard.press("Enter"); // select highlighted option, or create if none
    // Wait for chip to appear before closing — prevents Enter/Escape race condition in CI.
    await expect(stickyColsInput).toContainText("instance", { timeout: 5000 });
    await page.keyboard.press("Escape"); // close dropdown so it doesn't intercept Apply button
    testLogger.info("Sticky column 'instance' added");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying sticky columns persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const stickyAfterInput = pm.dashboardPanelConfigs.stickyColumns;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyAfterInput);
    await expect(stickyAfterInput).toContainText("instance", { timeout: 10000 });
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky columns disabled when sticky first column (Aggregate mode): enable toggle → sticky columns input disabled → disable toggle → re-enabled", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const stickyFirstColToggle = pm.dashboardPanelConfigs.stickyFirstColumn;
    const stickyColsInput = pm.dashboardPanelConfigs.stickyColumns;
    const stickyColsTrigger = pm.dashboardPanelConfigs.stickyColumnsTrigger;

    // Scroll sticky columns into view to verify initial state
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsTrigger).not.toBeDisabled();
    testLogger.info("Sticky columns is initially enabled");

    // Enable sticky_first_column — sticky columns select should become disabled
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyFirstColToggle);
    await stickyFirstColToggle.click();
    testLogger.info("Sticky first column toggle enabled");

    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsTrigger).toBeDisabled();
    testLogger.info("Sticky columns input is disabled");

    // Disable sticky_first_column — sticky columns select should be enabled again
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyFirstColToggle);
    await stickyFirstColToggle.click();
    testLogger.info("Sticky first column toggle disabled");

    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsTrigger).not.toBeDisabled();
    testLogger.info("Sticky columns input is re-enabled");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("column order button (Aggregate mode): button visible → click → dialog opens → cancel closes dialog", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const columnOrderBtn = pm.dashboardPanelConfigs.columnOrderBtn;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(columnOrderBtn);
    await expect(columnOrderBtn).toBeVisible();

    await columnOrderBtn.click();
    testLogger.info("Column order button clicked");

    // Dialog should open
    const dialog = pm.dashboardPanelConfigs.columnOrderDialog;
    await expect(dialog).toBeVisible({ timeout: 5000 });
    testLogger.info("Column order dialog opened");

    // Cancel closes the dialog (ODialog secondary button inside the scoped panel)
    await pm.dashboardPanelConfigs.columnOrderDialogSecondaryBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    testLogger.info("Column order dialog closed via Cancel");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("column order move down (Aggregate mode): first column moves to position 2 → save → persists after panel save+reopen", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    // Apply to load chart data so available columns are populated
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Wait for at least 2 column rows to be present
    await pm.dashboardPanelConfigs.columnOrderRow(0).waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.columnOrderRow(1).waitFor({ state: 'visible', timeout: 10000 });

    // Record column names before move
    const nameBefore0 = await pm.dashboardPanelConfigs.getColumnName(0);
    const nameBefore1 = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info("Column names before move", { row0: nameBefore0, row1: nameBefore1 });

    // Move column at index 0 down (→ now at index 1)
    await pm.dashboardPanelConfigs.moveColumnDown(0);
    testLogger.info("Moved column 0 down");

    // Row 0 should now contain what was previously row 1's name
    const nameAfter0 = await pm.dashboardPanelConfigs.getColumnName(0);
    expect(nameAfter0).toBe(nameBefore1);
    testLogger.info("Column order changed correctly after move down");

    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info("Column order saved");

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying column order persists after panel save+reopen");

    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelConfigs.openColumnOrderDialog();
    await pm.dashboardPanelConfigs.columnOrderRow(0).waitFor({ state: 'visible', timeout: 10000 });

    const namePersisted = await pm.dashboardPanelConfigs.getColumnName(0);
    expect(namePersisted).toBe(nameBefore1);
    testLogger.info("Column order persisted: row 0 is still the moved column");

    await pm.dashboardPanelConfigs.cancelColumnOrder();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("column order move up (Aggregate mode): second column moves to position 1 → save → order updated", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    await pm.dashboardPanelConfigs.columnOrderRow(0).waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.columnOrderRow(1).waitFor({ state: 'visible', timeout: 10000 });

    const nameBefore0 = await pm.dashboardPanelConfigs.getColumnName(0);
    const nameBefore1 = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info("Column names before move", { row0: nameBefore0, row1: nameBefore1 });

    // Move column at index 1 up (→ now at index 0)
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    testLogger.info("Moved column 1 up");

    // Row 0 should now contain what was previously row 1's name
    const nameAfter0 = await pm.dashboardPanelConfigs.getColumnName(0);
    expect(nameAfter0).toBe(nameBefore1);
    testLogger.info("Column order changed correctly after move up");

    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info("Column order saved");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // GeoMap config — only visible in PromQL geomap chart type
  // ---------------------------------------------------------------------------

  test("PromQL geomap - geo lat/lon/weight labels: set values → apply; reopen → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLGeomapPanelWithConfig(page, pm, dashboardName);

    const latInput = pm.dashboardPanelConfigs.geoLatLabel;
    const lonInput = pm.dashboardPanelConfigs.geoLonLabel;
    const weightInput = pm.dashboardPanelConfigs.geoWeightLabel;

    await pm.dashboardPanelConfigs.scrollSidebarToElement(latInput);
    await expect(latInput).toBeVisible();
    await expect(lonInput).toBeVisible();
    await expect(weightInput).toBeVisible();

    await latInput.locator('[data-test$="-field"]').fill("lat_field");
    await lonInput.locator('[data-test$="-field"]').fill("lon_field");
    await weightInput.locator('[data-test$="-field"]').fill("weight_field");
    testLogger.info("Geo lat/lon/weight labels set");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying geo labels persist after save");
    await reopenPanelConfig(page, pm);

    const latAfter = pm.dashboardPanelConfigs.geoLatLabel;
    const lonAfter = pm.dashboardPanelConfigs.geoLonLabel;
    const weightAfter = pm.dashboardPanelConfigs.geoWeightLabel;

    await pm.dashboardPanelConfigs.scrollSidebarToElement(latAfter);
    await expect(latAfter.locator('[data-test$="-field"]')).toHaveValue("lat_field");
    await expect(lonAfter.locator('[data-test$="-field"]')).toHaveValue("lon_field");
    await expect(weightAfter.locator('[data-test$="-field"]')).toHaveValue("weight_field");
    testLogger.info("Geo lat/lon/weight labels persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // Maps config — only visible in PromQL maps chart type
  // ---------------------------------------------------------------------------

  test("PromQL maps - name label and map type: set name label → select map type → apply; reopen → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLMapsPanelWithConfig(page, pm, dashboardName);

    const nameLabelInput = pm.dashboardPanelConfigs.mapsNameLabel;
    const mapTypeSelect = pm.dashboardPanelConfigs.mapType;

    await pm.dashboardPanelConfigs.scrollSidebarToElement(nameLabelInput);
    await expect(nameLabelInput).toBeVisible();

    await nameLabelInput.locator('[data-test$="-field"]').fill("country_name");
    testLogger.info("Maps name label set to 'country_name'");

    // Map type select — click and choose "World" (label is capitalized via t("dashboard.world"))
    await pm.dashboardPanelConfigs.scrollSidebarToElement(mapTypeSelect);
    await expect(mapTypeSelect).toBeVisible();
    await pm.dashboardPanelConfigs.mapTypeTrigger.click();
    const worldOption = pm.dashboardPanelConfigs.getMapTypeOption("World");
    await worldOption.waitFor({ state: "visible" });
    await worldOption.click();
    testLogger.info("Maps map type set to 'World'");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying maps config persists after save");
    await reopenPanelConfig(page, pm);

    const nameLabelAfter = pm.dashboardPanelConfigs.mapsNameLabel;
    const mapTypeAfter = pm.dashboardPanelConfigs.mapType;

    await pm.dashboardPanelConfigs.scrollSidebarToElement(nameLabelAfter);
    await expect(nameLabelAfter.locator('[data-test$="-field"]')).toHaveValue("country_name");

    // OSelect trigger carries data-test-selected-value with the raw stored value
    await pm.dashboardPanelConfigs.scrollSidebarToElement(mapTypeAfter);
    await expect(pm.dashboardPanelConfigs.mapTypeTrigger).toHaveAttribute('data-test-selected-value', 'world');
    testLogger.info("Maps name label and map type persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // Donut aggregation — same option as pie, different chart type
  // ---------------------------------------------------------------------------

  test("aggregation function: visible for PromQL donut → change to Min → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLDonutPanelWithConfig(page, pm, dashboardName);

    const aggregationDropdown = pm.dashboardPanelConfigs.aggregation;
    await expect(aggregationDropdown).toBeVisible();
    testLogger.info("Aggregation dropdown visible for donut chart");

    await aggregationDropdown.click();
    await pm.dashboardPanelConfigs.getAggregationOption("Min (minimum value)").click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Min on donut");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying aggregation Min persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.aggregation).toContainText("Min");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // Query tab switching + per-query legend persistence (PromQL multi-query)
  // ---------------------------------------------------------------------------

  test("multi-query: set legend per query → save → reopen → each query legend persists on correct tab", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    // Set legend for Query 1 (currentQueryIndex = 0 by default).
    // The PromQL legend uses OCombobox (data-test="dashboard-config-promql-legend");
    // its inner input carries data-test="dashboard-config-promql-legend-input".
    const legendInput = pm.dashboardPanelConfigs.promqlLegend;
    const legendField = legendInput.locator('[data-test="dashboard-config-promql-legend-input"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await legendField.fill("Legend Q1");
    testLogger.info("Legend set for Query 1");

    // Add a second query via query editor add button (data-test has literal backticks — use *=)
    const addQueryBtn = pm.dashboardPanelConfigs.addQueryBtn;
    await addQueryBtn.waitFor({ state: 'visible', timeout: 10000 });
    await addQueryBtn.click();
    testLogger.info("Second query added");

    // Config panel now shows 2 tabs — switch to Query 2
    const tab0 = pm.dashboardPanelConfigs.getConfigQueryTab(0);
    const tab1 = pm.dashboardPanelConfigs.getConfigQueryTab(1);
    await tab1.waitFor({ state: 'visible', timeout: 5000 });
    await expect(tab0).toBeVisible();
    await expect(tab1).toBeVisible();
    await tab1.click();
    await expect(tab1).toHaveAttribute("aria-selected", "true");
    testLogger.info("Switched to Query 2 tab");

    // Set legend for Query 2
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await legendField.fill("Legend Q2");
    testLogger.info("Legend set for Query 2");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying per-query legends persist after save");
    await reopenPanelConfig(page, pm);

    // Query 1 tab should show "Legend Q1"
    const tab0After = pm.dashboardPanelConfigs.getConfigQueryTab(0);
    const tab1After = pm.dashboardPanelConfigs.getConfigQueryTab(1);
    await tab0After.waitFor({ state: 'visible', timeout: 5000 });
    await tab0After.click();
    await expect(tab0After).toHaveAttribute("aria-selected", "true");
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await expect(legendField).toHaveValue("Legend Q1");
    testLogger.info("Query 1 legend persisted");

    // Query 2 tab should show "Legend Q2"
    await tab1After.click();
    await expect(tab1After).toHaveAttribute("aria-selected", "true");
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await expect(legendField).toHaveValue("Legend Q2");
    testLogger.info("Query 2 legend persisted");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // ---------------------------------------------------------------------------
  // Metric-panel config: sparkline + value mapping, on the PromQL path.
  //
  // The SQL equivalents live in dashboard-config-advanced.spec.js. These cover
  // the same ConfigPanel features against a metrics stream + PromQL query, which
  // is a genuinely different code path: convertPromQLData.ts (not
  // convertSQLMetricChart.ts) resolves the metric style, and the sparkline trend
  // comes from the matrix values already in the response rather than a second
  // is_ui_histogram fetch.
  // ---------------------------------------------------------------------------

  test("sparkline (PromQL metric): enable → sub-controls appear → persists after save", {
    tag: ['@dashboard', '@configPanel', '@sparkline', '@promql', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLMetricPanelWithConfig(page, pm, dashboardName);

    await pm.dashboardPanelConfigs.enableSparkline();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);
    await expect(pm.dashboardPanelConfigs.sparklineType).toBeVisible();
    await expect(pm.dashboardPanelConfigs.sparklineLayout).toBeVisible();
    testLogger.info("Sparkline enabled on PromQL metric panel — sub-controls visible");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Verifying sparkline toggle persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expandAllConfigSections();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sparkline (PromQL metric): type gates line-width/fill-opacity; layout + width round-trip", {
    tag: ['@dashboard', '@configPanel', '@sparkline', '@promql', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLMetricPanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.enableSparkline();

    const lineWidth = pm.dashboardPanelConfigs.sparklineLineWidthInput;
    const fillOpacity = pm.dashboardPanelConfigs.sparklineFillOpacity;

    // Default type is Auto (→ area): line width visible
    await expect(lineWidth).toBeVisible();

    await pm.dashboardPanelConfigs.selectSparklineType("Bar");
    await expect(lineWidth).toBeHidden();
    await expect(fillOpacity).toBeHidden();
    testLogger.info("Bar type hides line width + fill opacity");

    await pm.dashboardPanelConfigs.selectSparklineType("Area");
    await expect(lineWidth).toBeVisible();
    await expect(fillOpacity).toBeVisible();
    testLogger.info("Area type shows line width + fill opacity");

    await pm.dashboardPanelConfigs.setSparklineLineWidth(3);
    await pm.dashboardPanelConfigs.selectSparklineLayout("Background");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Verifying sparkline type/layout/width persist after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expandAllConfigSections();
    await expect(pm.dashboardPanelConfigs.sparklineType).toContainText("Area");
    await expect(pm.dashboardPanelConfigs.sparklineLayout).toContainText("Background");
    expect(await pm.dashboardPanelConfigs.getSparklineLineWidth()).toBe("3");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sparkline (PromQL metric): Apply fires exactly 1 query_range, no is_ui_histogram companion", {
    tag: ['@dashboard', '@configPanel', '@sparkline', '@promql', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLMetricPanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.enableSparkline();
    expect(await pm.dashboardPanelConfigs.isSparklineEnabled()).toBe(true);

    // Record URLs/status only. Never read the body of a PromQL response: it is a
    // live SSE stream the page is still consuming, and pulling it through
    // Playwright competes with the page's own reader.
    const allCalls = [];
    const isPromQLQuery = (url) => url.includes("/prometheus/api/v1/query");
    const onResponse = (res) => {
      const url = res.url();
      if (url.includes("/api/")) allCalls.push({ url, status: res.status() });
    };
    page.on("response", onResponse);

    // One Apply, then wait on the panel's own completion signal rather than a
    // network event — the Apply button stays disabled until every chunk lands.
    await pm.dashboardPanelActions.applyDashboardBtn();
    const settled = await waitForPanelRenderSettled(page, pm);
    page.off("response", onResponse);

    const callsDiag = `captured /api/ calls: ${JSON.stringify(allCalls)}`;
    expect(settled, `panel never finished loading. ${callsDiag}`).toBe(true);

    // The SQL metric sparkline fetches a second is_ui_histogram series; PromQL
    // must not — its trend comes from the matrix values already in the response.
    const promqlCalls = allCalls.filter((c) => isPromQLQuery(c.url));
    expect(promqlCalls.length, callsDiag).toBe(1);
    expect(allCalls.filter((c) => c.url.includes("is_ui_histogram")).length, callsDiag).toBe(0);
    testLogger.info("PromQL sparkline Apply fired exactly 1 query_range (no histogram)");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("value mapping (PromQL metric): text + background colour swatches round-trip through save", {
    tag: ['@dashboard', '@configPanel', '@valueMapping', '@promql', '@P1', '@all'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLMetricPanelWithConfig(page, pm, dashboardName);

    const popup = await pm.dashboardPanelConfigs.openValueMappingPopup();
    await pm.dashboardPanelConfigs.selectValueMappingType(popup, 0, "Between");
    await pm.dashboardPanelConfigs.fillValueMappingRange(popup, 0, {
      from: "-999999999999",
      to: "999999999999",
      text: "PROMQL_COLOURED",
    });
    const textSwatch = await pm.dashboardPanelConfigs.pickValueMappingColorSwatch(popup, 0, "text-color", 2);
    const bgSwatch = await pm.dashboardPanelConfigs.pickValueMappingColorSwatch(popup, 0, "bg-color", 2);
    await expect(textSwatch).toHaveAttribute("aria-pressed", "true");
    await expect(bgSwatch).toHaveAttribute("aria-pressed", "true");
    await pm.dashboardPanelConfigs.applyValueMappingPopup(popup);
    testLogger.info("Value mapping colours configured on PromQL metric panel");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Verifying value mapping colours persist after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.expandAllConfigSections();
    const reopened = await pm.dashboardPanelConfigs.openValueMappingPopup();
    await expect(
      pm.dashboardPanelConfigs.valueMappingColorSwatch(reopened, 0, "text-color", 2)
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      pm.dashboardPanelConfigs.valueMappingColorSwatch(reopened, 0, "bg-color", 2)
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      reopened
        .locator('[data-test="dashboard-addpanel-config-value-mapping-text-input-0"]')
        .locator('[data-test$="-field"]')
    ).toHaveValue("PROMQL_COLOURED");
    await pm.dashboardPanelConfigs.closeValueMappingPopup();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

});
