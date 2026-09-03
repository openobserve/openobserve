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
  setupBarPanel,
  setupBarPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
// Kept for reference, commented rather than deleted so it can be restored easily.
// This override beat --retries=0 locally (making a clean baseline impossible) and
// in CI it *cut* the project's retry budget (3 standard / 2 alpha1) down to 1.
// test.describe.configure({ retries: 1 });

test.describe("ConfigPanel — General Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("description: fill value, apply, save, reopen and verify it persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();
    const description = "Persistent description " + Date.now();

    await setupBarPanel(page, pm, dashboardName);
    await pm.dashboardPanelConfigs.openConfigPanel();

    const descriptionField = pm.dashboardPanelConfigs.description;
    await expect(descriptionField).toBeVisible();
    await descriptionField.locator('[data-test$="-field"]').fill(description);
    await pm.dashboardPanelActions.applyDashboardBtn();
    // Let the query finish before saving. Every other test in this file waits
    // after Apply; this one saved immediately, so savePanel could race an
    // in-flight query — the same apply/save race fixed in
    // dashboard-config-advanced.spec.js and dashboard-config-gauge-maps.spec.js.
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.savePanel();

    testLogger.info("Description saved, re-opening panel to verify persistence");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.description.locator('[data-test$="-field"]')).toHaveValue(description);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("unit: set Bytes → chart renders; set Custom → custom unit input appears + fill value", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const unitDropdown = pm.dashboardPanelConfigs.unit;
    await expect(unitDropdown).toBeVisible();

    // Set to Bytes
    await pm.dashboardPanelConfigs.selectUnit("Bytes");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Unit set to Bytes");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    // Set to Custom — custom unit input appears
    await pm.dashboardPanelConfigs.selectUnit("Custom");
    await expect(unitDropdown).toBeVisible();
    const customUnitInput = pm.dashboardPanelConfigs.customUnit;
    await expect(customUnitInput).toBeVisible();
    await customUnitInput.locator('[data-test$="-field"]').fill("ms");
    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying unit config persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.unit).toContainText("Custom");
    await expect(pm.dashboardPanelConfigs.customUnit.locator('[data-test$="-field"]')).toHaveValue("ms");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("decimals: set 0 → apply; set 4 → apply; chart renders in both cases", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const decimalsInput = pm.dashboardPanelConfigs.decimals;
    await expect(decimalsInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectDecimals("0");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Decimals set to 0");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelConfigs.selectDecimals("4");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Decimals set to 4");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying decimals config persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.decimals.locator('[data-test$="-field"]')).toHaveValue("4");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("no-value replacement: set N/A → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const noValueInput = pm.dashboardPanelConfigs.noValueReplacementWrapper;
    await expect(noValueInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectNoValueReplace("N/A");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("No-value replacement set to N/A");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying no-value replacement persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.noValueReplacementWrapper.locator('[data-test$="-field"]')).toHaveValue("N/A");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("query limit: set 100 → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const limitInput = pm.dashboardPanelConfigs.queryLimit;
    await expect(limitInput).toBeVisible();

    await pm.dashboardPanelConfigs.selectQueryLimit("100");
    await pm.dashboardPanelActions.applyDashboardBtn();
    testLogger.info("Query limit set to 100");
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying query limit persists after save");
    await reopenPanelConfig(page, pm);
    await expect(pm.dashboardPanelConfigs.queryLimit.locator('[data-test$="-field"]')).toHaveValue("100");
    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
