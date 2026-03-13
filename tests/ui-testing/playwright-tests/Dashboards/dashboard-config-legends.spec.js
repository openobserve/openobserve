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

test.describe("ConfigPanel — Legends", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("show legends toggle: visible → disable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const showLegendsToggle = page.locator('[data-test="dashboard-config-show-legend"]');
    await expect(showLegendsToggle).toBeVisible();
    await showLegendsToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();

    testLogger.info("Show legends disabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying show legends toggle persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-show-legend"]')).toHaveAttribute("aria-checked", "false");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("legend position Right: set → width input appears + set value + toggle unit to % → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    // Width input requires legends_type=plain AND legends_position=right — set type first
    const legendTypeDropdown = page.locator('[data-test="dashboard-config-legends-scrollable"]');
    await legendTypeDropdown.click();
    await page.getByRole("option", { name: "Plain" }).click();
    await pm.dashboardPanelConfigs.legendPosition("Right");

    // Width input appears, height input does not
    const legendWidthInput = page.locator('[data-test="dashboard-config-legend-width"]');
    await expect(legendWidthInput).toBeVisible();
    await expect(page.locator('[data-test="dashboard-config-legend-height"]')).not.toBeVisible();

    // Set width value
    await legendWidthInput.click();
    await legendWidthInput.fill("200");

    // Toggle unit from px to %
    await expect(page.locator('[data-test="dashboard-config-legend-width-unit-active"]').first()).toBeVisible();
    await page.locator('[data-test="dashboard-config-legend-width-unit-inactive"]').click();
    await expect(page.locator('[data-test="dashboard-config-legend-width-unit-active"]').first()).toBeVisible();

    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Legend position Right: width set and unit toggled to %");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying legend position Right persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-legend-position"]')).toContainText("right");
    await expect(page.locator('[data-test="dashboard-config-legend-width"]')).toHaveValue("200");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("legend position Bottom: set → height input appears + set value + toggle unit to % → apply", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    // Height input requires legends_type=plain AND legends_position=bottom — set type first
    const legendTypeDropdown = page.locator('[data-test="dashboard-config-legends-scrollable"]');
    await legendTypeDropdown.click();
    await page.getByRole("option", { name: "Plain" }).click();
    await pm.dashboardPanelConfigs.legendPosition("Bottom");

    // Height input appears, width input does not
    const legendHeightInput = page.locator('[data-test="dashboard-config-legend-height"]');
    await expect(legendHeightInput).toBeVisible();
    await expect(page.locator('[data-test="dashboard-config-legend-width"]')).not.toBeVisible();

    // Set height value
    await legendHeightInput.click();
    await legendHeightInput.fill("100");

    // Toggle unit from px to %
    await expect(page.locator('[data-test="dashboard-config-legend-height-unit-active"]').first()).toBeVisible();
    await page.locator('[data-test="dashboard-config-legend-height-unit-inactive"]').click();
    await expect(page.locator('[data-test="dashboard-config-legend-height-unit-active"]').first()).toBeVisible();

    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Legend position Bottom: height set and unit toggled to %");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying legend position Bottom persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-legend-position"]')).toContainText("bottom");
    await expect(page.locator('[data-test="dashboard-config-legend-height"]')).toHaveValue("100");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("legend position Auto: set Right then reset to Auto → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.legendPosition("Right");
    await pm.dashboardPanelConfigs.legendPosition("Auto");
    await pm.dashboardPanelActions.applyDashboardBtn();

    testLogger.info("Legend position restored to Auto");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying legend position Auto persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-legend-position"]')).toContainText("Auto");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("legend type: Scroll → apply; Plain → apply; chart renders in both cases", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const legendTypeDropdown = page.locator('[data-test="dashboard-config-legends-scrollable"]');
    await expect(legendTypeDropdown).toBeVisible();

    await legendTypeDropdown.click();
    await page.getByRole("option", { name: "Scroll" }).click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Legend type set to Scroll");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await legendTypeDropdown.click();
    await page.getByRole("option", { name: "Plain" }).click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Legend type set to Plain");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying legend type Plain persists after save");
    await reopenPanelConfig(page, pm);
    await expect(page.locator('[data-test="dashboard-config-legends-scrollable"]')).toContainText("plain");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
