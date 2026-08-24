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
// No file-level `retries` override: it pinned this file to 1 retry, which both added
// a retry locally (project default 0, hiding flakes during development) and *cut*
// CI's 3 retries down to 1. The project-level policy is the right one.

test.describe("ConfigPanel — Axis Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("Y-axis min + max: set min 50 → apply; set max 1000 → apply; clear both → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const yAxisMinInput = pm.dashboardPanelConfigs.yAxisMin;
    const yAxisMaxInput = pm.dashboardPanelConfigs.yAxisMax;
    await expect(yAxisMinInput).toBeVisible();
    await expect(yAxisMaxInput).toBeVisible();

    await pm.dashboardPanelConfigs.Y_AxisMin("50");
    await pm.dashboardPanelConfigs.Y_AxisMax("1000");
    // Confirm the values actually landed. Without this the test is vacuous: its only
    // persistence assertion is that both fields end up EMPTY, which a pair of fills
    // that silently no-opped would satisfy just as well as a real set-then-clear.
    await expect(yAxisMinInput.locator('[data-test$="-field"]')).toHaveValue("50");
    await expect(yAxisMaxInput.locator('[data-test$="-field"]')).toHaveValue("1000");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Y-axis min=50, max=1000");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Clear both to restore auto-scaling
    await yAxisMinInput.locator('[data-test$="-field"]').fill("");
    await yAxisMaxInput.locator('[data-test$="-field"]').fill("");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Y-axis min/max cleared");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying Y-axis cleared state persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.yAxisMin.locator('[data-test$="-field"]')).toHaveValue("");
    await expect(pm.dashboardPanelConfigs.yAxisMax.locator('[data-test$="-field"]')).toHaveValue("");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("axis width: visible → set 80 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await expect(pm.dashboardPanelConfigs.axisWidth).toBeVisible();
    await pm.dashboardPanelConfigs.selectAxisWidth("80");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Axis width set to 80");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying axis width persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.axisWidth.locator('[data-test$="-field"]')).toHaveValue("80");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("axis border: visible → enable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const axisBorderToggle = pm.dashboardPanelConfigs.axisBorder;
    await expect(axisBorderToggle).toBeVisible();
    // Default is axis_border_show: false. Asserting the starting state makes the
    // post-save "true" assertion meaningful — otherwise a toggle that was already
    // on, or a click that did nothing, is indistinguishable from a working one.
    await expect(axisBorderToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "false");
    await axisBorderToggle.click();
    await expect(axisBorderToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Axis border enabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying axis border enabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.axisBorder.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("gridlines: visible → disable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const gridlinesToggle = pm.dashboardPanelConfigs.showGridlines;
    await expect(gridlinesToggle).toBeVisible();
    // Default is show_gridlines: true — assert it starts on so "disable" is a real
    // state change rather than a no-op that happens to end in the expected state.
    await expect(gridlinesToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await gridlinesToggle.click();
    await expect(gridlinesToggle.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "false");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Gridlines disabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying gridlines disabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.showGridlines.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "false");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("label position + label rotate: set Top → apply; rotate 45 → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await expect(pm.dashboardPanelConfigs.valuePosition).toBeVisible();
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
    await expect(pm.dashboardPanelConfigs.labelPositionTrigger).toHaveAttribute('data-test-selected-value', 'top');
    await expect(pm.dashboardPanelConfigs.valueRotate.locator('[data-test$="-field"]')).toHaveValue("45");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("x-axis label rotate: visible → set 30 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const axisLabelRotateInput = pm.dashboardPanelConfigs.axisLabelRotate;
    await expect(axisLabelRotateInput).toBeVisible();
    await axisLabelRotateInput.locator('[data-test$="-field"]').fill("30");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("X-axis label rotate set to 30");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying x-axis label rotate persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.axisLabelRotate.locator('[data-test$="-field"]')).toHaveValue("30");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("label truncate width: visible → set 50 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const truncateInput = pm.dashboardPanelConfigs.axisLabelTruncate;
    await expect(truncateInput).toBeVisible();
    await truncateInput.locator('[data-test$="-field"]').fill("50");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Label truncate width set to 50");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying label truncate width persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.axisLabelTruncate.locator('[data-test$="-field"]')).toHaveValue("50");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
