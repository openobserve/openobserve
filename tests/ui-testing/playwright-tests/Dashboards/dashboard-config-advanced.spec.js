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
  setupBarPanelWithBreakdownAndConfig,
  setupTablePanelWithConfig,
  setupMetricPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
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

    // 0m reference row is always present
    const timeShiftRows = page.locator('.custom-date-time-picker');
    await expect(timeShiftRows).toHaveCount(1);

    // Add two time shifts
    await pm.dashboardPanelConfigs.addTimeShift();
    await pm.dashboardPanelConfigs.addTimeShift();
    await expect(timeShiftRows).toHaveCount(3);

    // Remove first added shift
    await pm.dashboardPanelConfigs.removeTimeShift(0);
    await expect(timeShiftRows).toHaveCount(2);

    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Time shift added and removed, chart renders");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying time shift count persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('.custom-date-time-picker')).toHaveCount(2);
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("trellis disabled when time shifts are active", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.addTimeShift();

    await expect(page.locator('[data-test="dashboard-trellis-chart"]')).toHaveAttribute("aria-disabled", "true");
    testLogger.info("Trellis disabled with time shifts active");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("color by series: button visible → open popup → save → chart renders; cancel → popup closes", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]')).toBeVisible();

    // Open and save
    await pm.dashboardPanelConfigs.openColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).toBeVisible();
    await pm.dashboardPanelConfigs.saveColorBySeries();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Color by series saved");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Open and cancel
    await pm.dashboardPanelConfigs.openConfigPanel();
    await pm.dashboardPanelConfigs.openColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).toBeVisible();
    await pm.dashboardPanelConfigs.cancelColorBySeries();
    await expect(page.locator('[data-test="dashboard-color-by-series-popup"]')).not.toBeVisible();
    testLogger.info("Color by series cancelled — popup closed");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("override config: button visible for table → add row → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const overrideBtn = page.locator('[data-test="dashboard-addpanel-config-override-config-add-btn"]');
    await expect(overrideBtn).toBeVisible();
    await overrideBtn.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Override config row added");
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("value mapping: button visible for table → add row → apply → table renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupTablePanelWithConfig(page, pm, dashboardName);

    const drilldownBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]');
    await expect(drilldownBtn).toBeVisible();
    await drilldownBtn.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Value mapping row added");
    await expect(page.locator('[data-test="dashboard-panel-table"]')).toBeVisible();

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

    const topNInput = page.locator('[data-test="dashboard-config-top-n"]');
    await expect(topNInput).toBeVisible();
    await topNInput.click();
    await topNInput.fill("5");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Top N set to 5");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    testLogger.info("Verifying top N value persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-top-n"]')).toHaveValue("5");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
