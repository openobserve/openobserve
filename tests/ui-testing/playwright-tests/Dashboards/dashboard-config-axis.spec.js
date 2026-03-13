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
  setupBarPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Axis Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("Y-axis min + max: set min 50 → apply; set max 1000 → apply; clear both → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const yAxisMinInput = page.locator('[data-test="dashboard-config-y_axis_min"]');
    const yAxisMaxInput = page.locator('[data-test="dashboard-config-y_axis_max"]');
    await expect(yAxisMinInput).toBeVisible();
    await expect(yAxisMaxInput).toBeVisible();

    await pm.dashboardPanelConfigs.Y_AxisMin("50");
    await pm.dashboardPanelConfigs.Y_AxisMax("1000");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Y-axis min=50, max=1000");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Clear both to restore auto-scaling
    await yAxisMinInput.click();
    await yAxisMinInput.fill("");
    await yAxisMaxInput.click();
    await yAxisMaxInput.fill("");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Y-axis min/max cleared");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying Y-axis cleared state persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-y_axis_min"]')).toHaveValue("");
    await expect(page.locator('[data-test="dashboard-config-y_axis_max"]')).toHaveValue("");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("axis width: visible → set 80 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-config-axis-width"]')).toBeVisible();
    await pm.dashboardPanelConfigs.selectAxisWidth("80");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Axis width set to 80");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying axis width persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-axis-width"]')).toHaveValue("80");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("axis border: visible → enable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const axisBorderToggle = page.locator('[data-test="dashboard-config-axis-border"]');
    await expect(axisBorderToggle).toBeVisible();
    await axisBorderToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Axis border enabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying axis border enabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-axis-border"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("gridlines: visible → disable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const gridlinesToggle = page.locator('[data-test="dashboard-config-show-gridlines"]');
    await expect(gridlinesToggle).toBeVisible();
    await gridlinesToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Gridlines disabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying gridlines disabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-show-gridlines"]')).toHaveAttribute("aria-checked", "false");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("label position + label rotate: set Top → apply; rotate 45 → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await expect(page.locator('[data-test="dashboard-config-label-position"]')).toBeVisible();
    await pm.dashboardPanelConfigs.selectValuePosition("Top");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Label position set to Top");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelConfigs.selectValueRotate("45");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Label rotate set to 45");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying label position and rotate persist after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-label-position"]')).toContainText("Top");
    await expect(page.locator('[data-test="dashboard-config-label-rotate"]')).toHaveValue("45");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("x-axis label rotate: visible → set 30 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const axisLabelRotateInput = page.locator('[data-test="dashboard-config-axis-label-rotate"]');
    await expect(axisLabelRotateInput).toBeVisible();
    await axisLabelRotateInput.click();
    await axisLabelRotateInput.fill("30");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("X-axis label rotate set to 30");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying x-axis label rotate persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-axis-label-rotate"]')).toHaveValue("30");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("label truncate width: visible → set 50 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const truncateInput = page.locator('[data-test="dashboard-config-axis-label-truncate-width"]');
    await expect(truncateInput).toBeVisible();
    await truncateInput.click();
    await truncateInput.fill("50");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Label truncate width set to 50");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying label truncate width persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-axis-label-truncate-width"]')).toHaveValue("50");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
