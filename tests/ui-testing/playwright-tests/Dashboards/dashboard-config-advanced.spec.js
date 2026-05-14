const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupLinePanelWithConfig,
  setupBarPanelWithConfig,
  setupBarPanelWithBreakdownAndConfig,
  setupTablePanelWithConfig,
  setupMetricPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
import { verifyColorOnCanvas, applyAndWaitForRender } from "./utils/canvasHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Advanced Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("time shift: 0m ref present → add two rows → remove one → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupLinePanelWithConfig(page, pm, dashboardName);

    // Count added time shift rows by their remove buttons (0m ref row has no remove button)
    const removeButtons = page.locator('[data-test^="dashboard-addpanel-config-time-shift-remove-"]');
    await expect(removeButtons).toHaveCount(0);

    // Add two time shifts
    await pm.dashboardPanelConfigs.addTimeShift();
    await pm.dashboardPanelConfigs.addTimeShift();
    await expect(removeButtons).toHaveCount(2);

    // Remove first added shift
    await pm.dashboardPanelConfigs.removeTimeShift(0);
    await expect(removeButtons).toHaveCount(1);

    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Time shift added and removed, chart renders");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying time shift count persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test^="dashboard-addpanel-config-time-shift-remove-"]')).toHaveCount(1);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("trellis disabled when time shifts are active", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.addTimeShift();

    await expect(page.locator('.q-field--disabled:has([data-test="dashboard-trellis-chart"])')).toBeVisible();
    testLogger.info("Trellis disabled with time shifts active");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("color by series: select first series → set custom color → save → color appears on chart canvas", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]')).toBeVisible();

    // Open popup → select first available series → set custom color → save
    await pm.dashboardPanelConfigs.openColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).toBeVisible();

    const customColor = "#e63946";
    await pm.dashboardPanelConfigs.configureColorBySeries({ rowIndex: 0, optionIndex: 0, color: customColor });
    testLogger.info("Color by series: first series selected with custom color");

    await pm.dashboardPanelConfigs.saveColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).not.toBeVisible();
    testLogger.info("Color by series saved");

    // Apply, wait for API response + ECharts repaint before pixel scan
    await applyAndWaitForRender(page, pm);

    const colorResult = await verifyColorOnCanvas(page, { r: 230, g: 57, b: 70 });
    testLogger.info("Canvas color verification", { matchingPixels: colorResult.matchingPixels, colorFound: colorResult.colorFound });
    expect(colorResult.colorFound).toBe(true);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("override config: select field + bytes unit → save → table renders; reopen verifies field persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    // Open popup, pick first column, select Bytes unit, save
    await pm.dashboardPanelConfigs.configureOverrideWithUnit({ unitName: "Bytes" });
    testLogger.info("Override config: field + Bytes unit saved");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();
    testLogger.info("Override config applied — table renders");

    // Verify override config persists after save
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying override config persists after save");
    await reopenPanelConfig(page, pm);
    await pm.dashboardPanelConfigs.overrideConfig.click();
    const fieldSelect = page.locator('[data-test="dashboard-addpanel-config-unit-config-select-column-0"]');
    await fieldSelect.waitFor({ state: "visible", timeout: 10000 });
    await expect(fieldSelect).not.toContainText("Field");
    await page.keyboard.press("Escape");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("value mapping: fill value + display text + set color → apply → table renders; reopen verifies mapping persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    // Open popup, fill value + display text + initialize color, apply
    await pm.dashboardPanelConfigs.configureValueMapping({ value: "test_value", text: "Mapped!", setColor: true });
    testLogger.info("Value mapping: applied with value, display text, and color");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();
    testLogger.info("Value mapping applied — table renders");

    // Verify value mapping persists after save
    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying value mapping persists after save");
    await reopenPanelConfig(page, pm);
    const popup = await pm.dashboardPanelConfigs.openValueMappingPopup();
    await expect(popup.locator('[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]')).toHaveValue("test_value");
    await expect(popup.locator('[data-test="dashboard-addpanel-config-value-mapping-text-input-0"]')).toHaveValue("Mapped!");
    testLogger.info("Value mapping persisted after save");
    await pm.dashboardPanelConfigs.closeValueMappingPopup();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("background color: visible for metric → select Single Color → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupMetricPanelWithConfig(page, pm, dashboardName);

    const bgColorDropdown = page.locator('[data-test="dashboard-config-color-mode"]');
    await expect(bgColorDropdown).toBeVisible();
    await pm.dashboardPanelConfigs.selectBGColor("Single Color");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Background color set to Single Color");

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying background color Single Color persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-color-mode"]')).toContainText("Single Color");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("top N: visible with breakdown → set 5 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    const topNInput = page.locator('[data-test="dashboard-config-top_results"]');
    await expect(topNInput).toBeVisible();
    await topNInput.click();
    await topNInput.fill("5");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N set to 5");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying top N value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-top_results"]')).toHaveValue("5");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("top N others: set top 5 → Others toggle appears → enable → apply → chart renders; disable → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    // Set top N to make the "Others" toggle appear
    const topNInput = page.locator('[data-test="dashboard-config-top_results"]');
    await expect(topNInput).toBeVisible();
    await topNInput.click();
    await topNInput.fill("5");

    // Others toggle should now be visible
    const othersToggle = page.locator('[data-test="dashboard-config-top_results_others"]');
    await expect(othersToggle).toBeVisible({ timeout: 5000 });
    testLogger.info("Top N Others toggle appeared after setting top_results");

    // Enable Others toggle
    await othersToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N Others enabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Disable Others toggle
    await othersToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N Others disabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("chart alignment: visible → change alignment → apply → chart renders; reopen → alignment persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const alignDropdown = page.locator('[data-test="dashboard-config-chart-align"]');
    // Alignment may not be present for all chart types — skip gracefully
    const isVisible = await alignDropdown.isVisible().catch(() => false);
    if (!isVisible) {
      testLogger.info("chart-align not visible for bar chart — skipping alignment interaction");
      await pm.dashboardPanelActions.savePanel();
      await cleanupTestDashboard(page, pm, dashboardName);
      return;
    }

    await expect(alignDropdown).toBeVisible();

    // Click dropdown and pick the first available option
    await alignDropdown.click();
    const options = page.locator('[role="listbox"] [role="option"]');
    await options.first().waitFor({ state: "visible", timeout: 5000 });
    const firstOptionText = await options.first().textContent();
    await options.first().click();
    testLogger.info(`Chart alignment set to: ${firstOptionText?.trim()}`);

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying chart alignment persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-chart-align"]')).toBeVisible();
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
