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
  setupPromQLPiePanelWithConfig,
  setupPromQLDonutPanelWithConfig,
  setupPromQLTablePanelWithConfig,
  setupPromQLGeomapPanelWithConfig,
  setupPromQLMapsPanelWithConfig,
  reopenPanelConfig,
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

    const stepValueInput = page.locator('[data-test="dashboard-config-step-value"]');
    await expect(stepValueInput).toBeVisible();

    // Clear and set step value to 5m
    await stepValueInput.click();
    await stepValueInput.fill("5m");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Step value set to 5m");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    // Save and verify persistence
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying step value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-step-value"]')).toHaveValue("5m");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("PromQL legend info: visible in PromQL mode → renders without errors", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const legendInfo = page.locator('[data-test="dashboard-config-promql-legend-info"]');
    await expect(legendInfo).toBeVisible();
    testLogger.info("PromQL legend info icon is visible in PromQL mode");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("aggregation function: visible for PromQL pie → change to Max → apply; change to Avg → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPiePanelWithConfig(page, pm, dashboardName);

    const aggregationDropdown = page.locator('[data-test="dashboard-config-aggregation"]');
    await expect(aggregationDropdown).toBeVisible();

    // Change aggregation to Max — full option label is "Max (maximum value)"
    await aggregationDropdown.click();
    await page.getByRole("option", { name: /^Max/i }).first().click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Max");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    // Change aggregation to Avg — full option label is "Avg (average)"
    await aggregationDropdown.click();
    await page.getByRole("option", { name: /^Avg/i }).first().click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Avg");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying aggregation Avg persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-aggregation"]')).toContainText("Avg");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("PromQL table mode: visible for PromQL table → switch to Expanded Time series → apply; switch to Aggregate → apply → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    const tableModeDropdown = page.locator('[data-test="dashboard-config-promql-table-mode"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await expect(tableModeDropdown).toBeVisible();

    // Switch to "Expanded Time series"
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Expanded Time series" }).click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("PromQL table mode set to Expanded Time series");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    // Switch to "Aggregate"
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Aggregate" }).click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("PromQL table mode set to Aggregate");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying PromQL table mode 'Aggregate' persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.scrollSidebarToElement(
      page.locator('[data-test="dashboard-config-promql-table-mode"]')
    );
    await expect(page.locator('[data-test="dashboard-config-promql-table-mode"]')).toContainText("Aggregate");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky first column: PromQL table (Aggregate mode) → enable toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    // Sticky first column only appears when promql_table_mode is 'all' or 'expanded_timeseries'
    // Switch to "Aggregate" mode first to reveal the sticky column controls
    const tableModeDropdown = page.locator('[data-test="dashboard-config-promql-table-mode"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Aggregate" }).click();
    testLogger.info("Table mode set to Aggregate — sticky column controls now visible");

    const stickyFirstCol = page.locator('[data-test="dashboard-config-sticky-first-column"]');
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
    const toggle = page.locator('[data-test="dashboard-config-sticky-first-column"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggle);
    // q-toggle renders with role="checkbox" and aria-checked attribute
    const ariaChecked = await toggle.getAttribute("aria-checked");
    expect(ariaChecked).toBe("true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("connect null values: PromQL line chart → enable toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLPanelWithConfig(page, pm, dashboardName);

    const connectNullToggle = page.locator('[data-test="dashboard-config-connect-null-values"]');
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
    const toggleAfter = page.locator('[data-test="dashboard-config-connect-null-values"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggleAfter);
    const ariaChecked = await toggleAfter.getAttribute("aria-checked");
    expect(ariaChecked).toBe("true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("wrap table cells: PromQL table → enable wrap toggle → apply; reopen → toggle state persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);

    const wrapToggle = page.locator('[data-test="dashboard-config-wrap-table-cells"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(wrapToggle);
    await expect(wrapToggle).toBeVisible();

    await wrapToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Wrap table cells enabled");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying wrap table cells persists after save");
    await reopenPanelConfig(page, pm);
    const toggleAfter = page.locator('[data-test="dashboard-config-wrap-table-cells"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(toggleAfter);
    const ariaChecked = await toggleAfter.getAttribute("aria-checked");
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
    const tableModeDropdown = page.locator('[data-test="dashboard-config-promql-table-mode"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(tableModeDropdown);
    await tableModeDropdown.click();
    await page.getByRole("option", { name: "Aggregate" }).click();
    testLogger.info("Table mode switched to Aggregate");
  }

  test("table aggregations (Aggregate mode): dropdown visible → add Avg to default Last → apply; reopen → multi-selection persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const aggDropdown = page.locator('[data-test="dashboard-config-table-aggregations"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(aggDropdown);
    await expect(aggDropdown).toBeVisible();

    // Default is ["last"] — add "avg" to get ["last", "avg"]; display shows "last (+1 more)"
    await aggDropdown.click();
    await page.getByRole("option", { name: /^Avg/i }).first().click();
    await page.keyboard.press("Escape");
    testLogger.info("Table aggregations: added Avg (now last + avg)");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying table aggregations persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const aggAfter = page.locator('[data-test="dashboard-config-table-aggregations"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(aggAfter);
    await expect(aggAfter).toContainText("(+1 more)");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("visible columns (Aggregate mode): type custom column → chip added → apply; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    // data-test is on the <input> element itself (Quasar passes attrs to native input)
    // Use xpath to find the parent q-field wrapper for display-value assertions
    const visibleColsInput = page.locator('[data-test="dashboard-config-visible-columns"]');
    const visibleColsWrapper = visibleColsInput.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(visibleColsInput);
    await expect(visibleColsInput).toBeVisible();

    // Type a custom column name and press Enter (new-value-mode="add-unique")
    // Explicit click ensures focus in headless CI before typing
    await visibleColsInput.click();
    await visibleColsInput.pressSequentially("instance");
    await visibleColsInput.press("Enter");
    await visibleColsInput.press("Escape"); // close dropdown so it doesn't intercept Apply button
    testLogger.info("Visible column 'instance' added");

    // Display-value in the q-field wrapper should now show "instance"
    await expect(visibleColsWrapper).toContainText("instance");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying visible columns persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const visibleAfterInput = page.locator('[data-test="dashboard-config-visible-columns"]');
    const visibleAfterWrapper = visibleAfterInput.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(visibleAfterInput);
    await expect(visibleAfterWrapper).toContainText("instance");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("hidden columns (Aggregate mode): type custom column → chip added → apply; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const hiddenColsInput = page.locator('[data-test="dashboard-config-hidden-columns"]');
    const hiddenColsWrapper = hiddenColsInput.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(hiddenColsInput);
    await expect(hiddenColsInput).toBeVisible();

    await hiddenColsInput.click();
    await hiddenColsInput.pressSequentially("job");
    await hiddenColsInput.press("Enter");
    await hiddenColsInput.press("Escape"); // close dropdown so it doesn't intercept Apply button
    testLogger.info("Hidden column 'job' added");

    await expect(hiddenColsWrapper).toContainText("job");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying hidden columns persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const hiddenAfterInput = page.locator('[data-test="dashboard-config-hidden-columns"]');
    const hiddenAfterWrapper = hiddenAfterInput.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(hiddenAfterInput);
    await expect(hiddenAfterWrapper).toContainText("job");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky columns (Aggregate mode): type custom column → chip added → apply; reopen → value persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    // Sticky columns multi-select is disabled when sticky_first_column=true — leave that toggle off
    const stickyColsInput = page.locator('[data-test="dashboard-config-sticky-columns"]');
    const stickyColsWrapper = stickyColsInput.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsInput).toBeVisible();

    await stickyColsInput.click();
    await stickyColsInput.pressSequentially("instance");
    await stickyColsInput.press("Enter");
    await stickyColsInput.press("Escape"); // close dropdown so it doesn't intercept Apply button
    testLogger.info("Sticky column 'instance' added");

    await expect(stickyColsWrapper).toContainText("instance");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying sticky columns persist after save");
    await reopenPanelConfig(page, pm);
    await switchToAggregateMode(page, pm);
    const stickyAfterInput = page.locator('[data-test="dashboard-config-sticky-columns"]');
    const stickyAfterWrapper = stickyAfterInput.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyAfterInput);
    await expect(stickyAfterWrapper).toContainText("instance");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("sticky columns disabled when sticky first column (Aggregate mode): enable toggle → sticky columns input disabled → disable toggle → re-enabled", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const stickyFirstColToggle = page.locator('[data-test="dashboard-config-sticky-first-column"]');
    const stickyColsInput = page.locator('[data-test="dashboard-config-sticky-columns"]');

    // Scroll sticky columns into view to verify initial state
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsInput).not.toBeDisabled();
    testLogger.info("Sticky columns is initially enabled");

    // Enable sticky_first_column — sticky columns select should become disabled
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyFirstColToggle);
    await stickyFirstColToggle.click();
    testLogger.info("Sticky first column toggle enabled");

    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsInput).toBeDisabled();
    testLogger.info("Sticky columns input is disabled");

    // Disable sticky_first_column — sticky columns select should be enabled again
    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyFirstColToggle);
    await stickyFirstColToggle.click();
    testLogger.info("Sticky first column toggle disabled");

    await pm.dashboardPanelConfigs.scrollSidebarToElement(stickyColsInput);
    await expect(stickyColsInput).not.toBeDisabled();
    testLogger.info("Sticky columns input is re-enabled");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("column order button (Aggregate mode): button visible → click → dialog opens → cancel closes dialog", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupPromQLTablePanelWithConfig(page, pm, dashboardName);
    await switchToAggregateMode(page, pm);

    const columnOrderBtn = page.locator('[data-test="dashboard-config-column-order-button"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(columnOrderBtn);
    await expect(columnOrderBtn).toBeVisible();

    await columnOrderBtn.click();
    testLogger.info("Column order button clicked");

    // Dialog should open
    const dialog = page.locator('[data-test="dashboard-column-order-popup"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    testLogger.info("Column order dialog opened");

    // Cancel closes the dialog (ODialog secondary button inside the scoped panel)
    await page
      .locator('[data-test="dashboard-column-order-popup"] [data-test="o-dialog-secondary-btn"]')
      .click();
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

    const latInput = page.locator('[data-test="dashboard-config-geo-lat-label"]');
    const lonInput = page.locator('[data-test="dashboard-config-geo-lon-label"]');
    const weightInput = page.locator('[data-test="dashboard-config-geo-weight-label"]');

    await pm.dashboardPanelConfigs.scrollSidebarToElement(latInput);
    await expect(latInput).toBeVisible();
    await expect(lonInput).toBeVisible();
    await expect(weightInput).toBeVisible();

    await latInput.fill("lat_field");
    await lonInput.fill("lon_field");
    await weightInput.fill("weight_field");
    testLogger.info("Geo lat/lon/weight labels set");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying geo labels persist after save");
    await reopenPanelConfig(page, pm);

    const latAfter = page.locator('[data-test="dashboard-config-geo-lat-label"]');
    const lonAfter = page.locator('[data-test="dashboard-config-geo-lon-label"]');
    const weightAfter = page.locator('[data-test="dashboard-config-geo-weight-label"]');

    await pm.dashboardPanelConfigs.scrollSidebarToElement(latAfter);
    await expect(latAfter).toHaveValue("lat_field");
    await expect(lonAfter).toHaveValue("lon_field");
    await expect(weightAfter).toHaveValue("weight_field");
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

    const nameLabelInput = page.locator('[data-test="dashboard-config-maps-name-label"]');
    const mapTypeSelect = page.locator('[data-test="dashboard-config-map-type"]');

    await pm.dashboardPanelConfigs.scrollSidebarToElement(nameLabelInput);
    await expect(nameLabelInput).toBeVisible();

    await nameLabelInput.fill("country_name");
    testLogger.info("Maps name label set to 'country_name'");

    // Map type select — click and choose "World" (label is capitalized via t("dashboard.world"))
    await pm.dashboardPanelConfigs.scrollSidebarToElement(mapTypeSelect);
    await expect(mapTypeSelect).toBeVisible();
    await mapTypeSelect.click();
    await page.getByRole("option", { name: "World", exact: true }).click();
    testLogger.info("Maps map type set to 'World'");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying maps config persists after save");
    await reopenPanelConfig(page, pm);

    const nameLabelAfter = page.locator('[data-test="dashboard-config-maps-name-label"]');
    const mapTypeAfter = page.locator('[data-test="dashboard-config-map-type"]');

    await pm.dashboardPanelConfigs.scrollSidebarToElement(nameLabelAfter);
    await expect(nameLabelAfter).toHaveValue("country_name");

    // Map type wrapper contains "world" (raw value — q-select uses emit-value without map-options)
    await pm.dashboardPanelConfigs.scrollSidebarToElement(mapTypeAfter);
    const mapTypeWrapper = mapTypeAfter.locator('xpath=ancestor::div[contains(@class,"q-field")][1]');
    await expect(mapTypeWrapper).toContainText("world");
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

    const aggregationDropdown = page.locator('[data-test="dashboard-config-aggregation"]');
    await expect(aggregationDropdown).toBeVisible();
    testLogger.info("Aggregation dropdown visible for donut chart");

    await aggregationDropdown.click();
    await page.getByRole("option", { name: /^Min/i }).first().click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Aggregation set to Min on donut");
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying aggregation Min persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-aggregation"]')).toContainText("Min");
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

    // Set legend for Query 1 (currentQueryIndex = 0 by default)
    const legendInput = page.locator('[data-test="common-auto-complete"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await legendInput.fill("Legend Q1");
    testLogger.info("Legend set for Query 1");

    // Add a second query via query editor add button (data-test has literal backticks — use *=)
    const addQueryBtn = page.locator('[data-test*="query-tab-add"]');
    await addQueryBtn.waitFor({ state: 'visible', timeout: 10000 });
    await addQueryBtn.click();
    testLogger.info("Second query added");

    // Config panel now shows 2 tabs — switch to Query 2
    const tab0 = page.locator('[data-test="dashboard-config-query-tab-0"]');
    const tab1 = page.locator('[data-test="dashboard-config-query-tab-1"]');
    await tab1.waitFor({ state: 'visible', timeout: 5000 });
    await expect(tab0).toBeVisible();
    await expect(tab1).toBeVisible();
    await tab1.click();
    await expect(tab1).toHaveAttribute("aria-selected", "true");
    testLogger.info("Switched to Query 2 tab");

    // Set legend for Query 2
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await legendInput.fill("Legend Q2");
    testLogger.info("Legend set for Query 2");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying per-query legends persist after save");
    await reopenPanelConfig(page, pm);

    // Query 1 tab should show "Legend Q1"
    const tab0After = page.locator('[data-test="dashboard-config-query-tab-0"]');
    const tab1After = page.locator('[data-test="dashboard-config-query-tab-1"]');
    await tab0After.waitFor({ state: 'visible', timeout: 5000 });
    await tab0After.click();
    await expect(tab0After).toHaveAttribute("aria-selected", "true");
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await expect(legendInput).toHaveValue("Legend Q1");
    testLogger.info("Query 1 legend persisted");

    // Query 2 tab should show "Legend Q2"
    await tab1After.click();
    await expect(tab1After).toHaveAttribute("aria-selected", "true");
    await pm.dashboardPanelConfigs.scrollSidebarToElement(legendInput);
    await expect(legendInput).toHaveValue("Legend Q2");
    testLogger.info("Query 2 legend persisted");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

});
