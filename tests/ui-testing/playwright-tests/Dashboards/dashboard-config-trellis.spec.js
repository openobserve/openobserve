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
  setupBarPanelWithBreakdownAndConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — Trellis Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("trellis layout: Auto → apply; Vertical → apply; Custom → columns input + set 3 → cap at 16", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);

    const trellisDropdown = pm.dashboardPanelConfigs.trellisLayout;
    await expect(trellisDropdown).toBeVisible();

    // Auto
    await pm.dashboardPanelConfigs.selectTrellisLayout("Auto");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Trellis set to Auto");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Vertical
    await pm.dashboardPanelConfigs.selectTrellisLayout("Vertical");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Trellis set to Vertical");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Custom — columns input appears, set 3, then cap at 16
    await pm.dashboardPanelConfigs.selectTrellisLayout("Custom");
    const colInput = pm.dashboardPanelConfigs.trellisNumColumns;
    await expect(colInput).toBeVisible();
    await colInput.locator('[data-test$="-field"]').fill("3");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Trellis Custom with 3 columns");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Cap at 16
    await colInput.locator('[data-test$="-field"]').fill("20");
    await colInput.locator('[data-test$="-field"]').blur();
    testLogger.info("Trellis columns capped at 16");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying trellis Custom layout and 16 columns persist after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.trellisTrigger).toHaveAttribute('data-test-selected-value', 'custom');
    await expect(pm.dashboardPanelConfigs.trellisNumColumns.locator('[data-test$="-field"]')).toHaveValue("16");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("trellis disabled when no breakdown field is set", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    // OSelect disabled state is on the trigger button, not the root wrapper div.
    await expect(pm.dashboardPanelConfigs.trellisTrigger).toBeDisabled();
    testLogger.info("Trellis disabled with no breakdown field");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("trellis disabled when time shifts are active", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
    await expect(pm.dashboardPanelConfigs.trellisTrigger).toBeEnabled();
    testLogger.info("Trellis enabled before time shift (breakdown present)");

    await pm.dashboardPanelConfigs.addTimeShift();

    await expect(pm.dashboardPanelConfigs.trellisTrigger).toBeDisabled();
    testLogger.info("Trellis disabled with time shifts active");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("group by Y axis: visible after trellis active → enable → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithBreakdownAndConfig(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.selectTrellisLayout("Auto");
    await pm.dashboardPanelActions.applyDashboardBtn();
    // Settle before interacting with the sidebar again — the toggle below is
    // clicked while this query would otherwise still be running.
    await pm.dashboardPanelActions.waitForChartToRender();

    const groupByYAxisToggle = pm.dashboardPanelConfigs.trellisGroupByYAxis;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(groupByYAxisToggle);
    await expect(groupByYAxisToggle).toBeVisible();
    await groupByYAxisToggle.click();
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Group by Y axis enabled");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying group by Y axis enabled persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.trellisGroupByYAxis.locator('[data-test$="-btn"]')).toHaveAttribute("aria-checked", "true");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
